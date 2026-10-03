import { cellOut, columnById, type Column, type Row, type Table } from '../compute/data.ts'
import { hashOf, type VerifyResult } from '../compute/interchange.ts'

/**
 * Dates out of a table, written as a calendar file.
 *
 * A person who has a table of dates wants those dates in their calendar, and Orbis has no calendar connection and is
 * never going to invent one. What it can do is write the file every calendar program on every computer already
 * understands -- an iCalendar file, RFC 5545, plain text -- and hand it over. Opening it is the person's own act, in
 * their own program, and Orbis never learns whether the events were added, so it must not say they were.
 *
 * What this file is careful about, because each of these is a way a calendar file is quietly wrong:
 *
 *   - **A date it cannot read is left out and counted**, never guessed at. `03/04/2026` is the third of April in most
 *     of the world and the fourth of March in one country; the same refusal the table engine makes is made here.
 *   - **A day is not a time.** A row with a date and no time of day becomes an all-day event, whose end is the next
 *     day, because that is how RFC 5545 writes a day. A row with a time becomes a timed event.
 *   - **A zone is never invented.** A time with no zone in the table is written as a floating local time -- whatever
 *     the clock says on the computer that opens it. A time Orbis read with a zone on it is written in UTC, which is
 *     the same instant. Orbis writes no VTIMEZONE, because it has no zone rules to write, and the note says which of
 *     the two happened.
 *   - **Text is escaped and lines are folded** the way the format says: a comma, a semicolon, a backslash and a line
 *     break inside a title would otherwise end the value early, and a line longer than 75 octets is not legal.
 *     Folding counts octets, not characters, and never cuts a character in half.
 *
 * Pure: no clock, no storage, no network. The time of writing comes in as a number so the same table gives the same
 * file twice, which is what makes the round trip below a real check.
 */

export const CALENDAR_LIMITS = Object.freeze({
  /** Events one file may hold. A table bigger than this has its first 2,000 rows written and says so. */
  events: 2000,
  title: 300,
  place: 300,
  notes: 4000,
  /** Octets a line may be before it is folded. RFC 5545 section 3.1. */
  line: 75
})

export interface CalendarError {
  error: 'no-date' | 'no-rows' | 'no-events' | 'parse' | 'invalid-argument'
  message: string
}

export const isCalendarError = (value: unknown): value is CalendarError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

/**
 * A point on a calendar, as the format writes one.
 *
 * `time` null means a whole day. `utc` says the time is an instant (written with a Z); false means the time floats --
 * 9 in the morning wherever the calendar is opened.
 */
export interface Moment {
  /** `YYYYMMDD`. */
  readonly date: string
  /** `HHMMSS`, or null for a whole day. */
  readonly time: string | null
  readonly utc: boolean
}

export interface CalendarEvent {
  uid: string
  title: string
  start: Moment
  /** The end, when the table gave a readable one after the start. An all-day event gets the next day written for it. */
  end: Moment | null
  place: string
  notes: string
}

/** Which column means what. Column ids, so a renamed heading does not change the answer. */
export interface CalendarColumnChoice {
  date: string
  time: string | null
  end: string | null
  title: string | null
  place: string | null
  notes: string | null
}

export interface CalendarBuild {
  events: CalendarEvent[]
  /** What was read from where, so the screen can say it and a person can correct it. */
  chosen: CalendarColumnChoice
  /** Rows left out because their date could not be read. */
  skipped: number
  notes: string[]
}

export interface CalendarFile {
  text: string
  bytes: Uint8Array
  hash: string
  events: number
}

// ---------------------------------------------------------------- reading a date without guessing

const MONTHS: Readonly<Record<string, number>> = Object.freeze({
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12
})

const pad = (value: number, width: number): string => String(value).padStart(width, '0')

/** Whether a year, month and day are a day that exists. February the thirtieth is not one. */
function realDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const lengths = [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= lengths[month - 1]
}

const stamp = (year: number, month: number, day: number): string => `${pad(year, 4)}${pad(month, 2)}${pad(day, 2)}`

/** The day after a `YYYYMMDD`, for an all-day event's end, which the format writes as the day it does not include. */
export function nextDay(date: string): string {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(4, 6))
  const day = Number(date.slice(6, 8))
  const at = new Date(Date.UTC(year, month - 1, day + 1))
  return stamp(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate())
}

/** A moment as one number, so two of them can be compared. A floating time is compared as though it were UTC. */
export function momentOrder(moment: Moment): number {
  const year = Number(moment.date.slice(0, 4))
  const month = Number(moment.date.slice(4, 6))
  const day = Number(moment.date.slice(6, 8))
  const time = moment.time ?? '000000'
  return Date.UTC(year, month - 1, day, Number(time.slice(0, 2)), Number(time.slice(2, 4)), Number(time.slice(4, 6)))
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|z|[+-]\d{2}:?\d{2})?$/
const DAY_MONTH_YEAR = /^(\d{1,2})[ -]([A-Za-z]{3,9})[ -,]+(\d{4})$/
const MONTH_DAY_YEAR = /^([A-Za-z]{3,9})[ -](\d{1,2}),?[ -]+(\d{4})$/
/** The compact forms a calendar file itself uses, so a file Orbis wrote reads back. */
const ICS_DATE = /^(\d{4})(\d{2})(\d{2})$/
const ICS_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/

/**
 * A date, and a time of day when the text carried one.
 *
 * Only the spellings that cannot be read two ways, which is the same rule the table engine applies: ISO, a written
 * month, and the calendar format's own compact form. A slashed date is refused on purpose.
 */
export function readMoment(raw: string): Moment | null {
  const text = String(raw ?? '').trim()
  if (text === '') return null

  const only = DATE_ONLY.exec(text) ?? ICS_DATE.exec(text)
  if (only) {
    const [year, month, day] = [Number(only[1]), Number(only[2]), Number(only[3])]
    return realDay(year, month, day) ? { date: stamp(year, month, day), time: null, utc: false } : null
  }

  const compact = ICS_TIME.exec(text)
  if (compact) {
    const [year, month, day] = [Number(compact[1]), Number(compact[2]), Number(compact[3])]
    if (!realDay(year, month, day)) return null
    const [hour, minute, second] = [Number(compact[4]), Number(compact[5]), Number(compact[6])]
    if (hour > 23 || minute > 59 || second > 59) return null
    return { date: stamp(year, month, day), time: `${pad(hour, 2)}${pad(minute, 2)}${pad(second, 2)}`, utc: compact[7] === 'Z' }
  }

  const full = DATE_TIME.exec(text)
  if (full) {
    const [year, month, day] = [Number(full[1]), Number(full[2]), Number(full[3])]
    if (!realDay(year, month, day)) return null
    const [hour, minute, second] = [Number(full[4]), Number(full[5]), Number(full[6] ?? 0)]
    if (hour > 23 || minute > 59 || second > 59) return null
    const zone = full[7] ?? ''
    if (zone === '') return { date: stamp(year, month, day), time: `${pad(hour, 2)}${pad(minute, 2)}${pad(second, 2)}`, utc: false }
    if (zone === 'Z' || zone === 'z') return { date: stamp(year, month, day), time: `${pad(hour, 2)}${pad(minute, 2)}${pad(second, 2)}`, utc: true }
    // An offset is the same instant written another way: moved to UTC rather than dropped.
    const sign = zone[0] === '-' ? -1 : 1
    const offset = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)))
    const at = new Date(Date.UTC(year, month - 1, day, hour, minute - offset, second))
    return {
      date: stamp(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate()),
      time: `${pad(at.getUTCHours(), 2)}${pad(at.getUTCMinutes(), 2)}${pad(at.getUTCSeconds(), 2)}`,
      utc: true
    }
  }

  const dmy = DAY_MONTH_YEAR.exec(text)
  if (dmy) {
    const month = MONTHS[dmy[2].toLowerCase()]
    const [day, year] = [Number(dmy[1]), Number(dmy[3])]
    return month && realDay(year, month, day) ? { date: stamp(year, month, day), time: null, utc: false } : null
  }

  const mdy = MONTH_DAY_YEAR.exec(text)
  if (mdy) {
    const month = MONTHS[mdy[1].toLowerCase()]
    const [day, year] = [Number(mdy[2]), Number(mdy[3])]
    return month && realDay(year, month, day) ? { date: stamp(year, month, day), time: null, utc: false } : null
  }
  return null
}

const CLOCK = /^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i

/**
 * A time of day on its own, from a column that holds only times.
 *
 * `9:30`, `09:30:00`, `9am`, `7 p.m.`. A bare number with no minutes and no am or pm is refused: `9` in a column
 * called "time" probably means nine o'clock and probably is not worth being wrong about.
 */
export function readClock(raw: string): string | null {
  const text = String(raw ?? '').trim()
  if (text === '') return null
  const found = CLOCK.exec(text)
  if (!found) return null
  let hour = Number(found[1])
  const minute = Number(found[2] ?? 0)
  const second = Number(found[3] ?? 0)
  const half = (found[4] ?? '').replace(/\./g, '').toLowerCase()
  if (minute > 59 || second > 59) return null
  if (half === 'am' || half === 'pm') {
    if (hour < 1 || hour > 12) return null
    if (half === 'pm' && hour !== 12) hour += 12
    if (half === 'am' && hour === 12) hour = 0
  } else {
    if (found[2] === undefined) return null
    if (hour > 23) return null
  }
  return `${pad(hour, 2)}${pad(minute, 2)}${pad(second, 2)}`
}

// ---------------------------------------------------------------- which column means what

const NAMED = {
  date: /\b(date|day|when|starts?|start date|begins?|due|deadline|scheduled|on)\b/i,
  time: /\b(time|start time|at|from|clock|hour)\b/i,
  end: /\b(end|ends|ended|finish|finishes|until|till|to|through|end time|end date)\b/i,
  title: /\b(title|name|event|summary|subject|task|activity|what|appointment|meeting)\b/i,
  place: /\b(place|location|where|venue|room|address|site|office)\b/i,
  notes: /\b(notes?|detail|details|comment|comments|remark|remarks|description|about)\b/i
} as const

const nameOf = (column: Column): string => `${column.name} ${column.sourceName}`

/**
 * How many of a column's values read as a date, out of how many it has.
 *
 * A column of dates that the table engine typed as text -- because one row says "to be confirmed" -- is still the
 * date column, and the rows that could not be read are left out and counted. So the heading and the reading are
 * weighed separately: a column whose heading says date needs one readable value, and a column with no such heading
 * has to be almost all dates before it is taken for one.
 */
function dateReadings(table: Table, column: Column): { present: number; read: number } {
  const at = table.columns.indexOf(column)
  const sample = table.rows.slice(0, 200)
  let read = 0
  let present = 0
  for (const row of sample) {
    const text = cellOut(row.cells[at] ?? null, column)
    if (text.trim() === '') continue
    present++
    if (readMoment(text)) read++
  }
  return { present, read }
}

/**
 * Which column holds the date, the time, the end, the title, the place and the notes.
 *
 * A column's type decides first, because a type was inferred from every value in the column rather than from its
 * heading; a heading decides between two columns of the same type. Anything the caller gives explicitly wins over
 * both, and a column id the caller gives that is not in the table is reported rather than ignored.
 */
export function chooseCalendarColumns(table: Table, given: Partial<CalendarColumnChoice> = {}): { chosen: CalendarColumnChoice | null; problems: string[] } {
  const problems: string[] = []
  const check = (key: keyof CalendarColumnChoice, id: string | null | undefined): string | null => {
    if (id === null || id === undefined || id === '') return null
    if (columnById(table, id)) return id
    problems.push(`There is no column called "${id}" to use as the ${key}.`)
    return null
  }

  const taken = new Set<string>()
  const claim = (id: string | null): string | null => {
    if (id === null) return null
    taken.add(id)
    return id
  }

  let date = claim(check('date', given.date))
  if (date === null) {
    const typed = table.columns.filter((one) => one.type === 'date')
    const named = typed.find((one) => NAMED.date.test(nameOf(one))) ?? typed[0]
    const loose = table.columns.find((one) => {
      if (!NAMED.date.test(nameOf(one)) || NAMED.end.test(nameOf(one))) return false
      return dateReadings(table, one).read > 0
    })
    const mostly = table.columns.find((one) => {
      const { present, read } = dateReadings(table, one)
      return present > 0 && read >= Math.ceil(present * 0.8)
    })
    const found = named ?? loose ?? mostly ?? null
    date = claim(found ? found.id : null)
  }
  if (date === null) return { chosen: null, problems }

  const pick = (key: keyof CalendarColumnChoice, pattern: RegExp, types?: readonly Column['type'][]): string | null => {
    const explicit = check(key, given[key] as string | undefined)
    if (explicit !== null) return claim(explicit)
    const found = table.columns.find((one) => !taken.has(one.id) && pattern.test(nameOf(one)) && (!types || types.includes(one.type)))
    return claim(found ? found.id : null)
  }

  // Notes before the title, because "description" is a word both could claim and a description is not a name.
  const notes = pick('notes', NAMED.notes)
  const end = pick('end', NAMED.end)
  const time = pick('time', NAMED.time)
  const place = pick('place', NAMED.place)
  let title = pick('title', NAMED.title)
  if (title === null) {
    // No heading said "title", so the first column of words that is not already spoken for names the event.
    const found = table.columns.find((one) => !taken.has(one.id) && (one.type === 'text' || one.type === 'category'))
    title = claim(found ? found.id : null)
  }
  return { chosen: { date, time, end, title, place, notes }, problems }
}

// ---------------------------------------------------------------- events

const cut = (value: string, limit: number): string => (value.length > limit ? `${value.slice(0, limit - 1)}…` : value)

/** What Orbis will read as a date, and the one spelling it refuses. Said whenever a date could not be read. */
export const DATE_SPELLINGS =
  'Orbis reads a date written as 2026-10-03, or as 3 October 2026, and refuses 03/10/2026 because that is two different days in two different countries.'

/**
 * A globally unique identifier for an event, from the event itself.
 *
 * Built from what the event is and when the file was written, so writing the same table twice gives the same
 * identifiers and a calendar updates the event rather than adding a second copy. The domain part is `orbis.invalid`
 * because there is no Orbis host for it to point at, and a reserved name says so honestly.
 */
export const calendarUid = (seed: string, index: number): string =>
  `orbis-${hashOf(new TextEncoder().encode(seed))}-${pad(index, 4)}@orbis.invalid`

/** The words that tell a person what the file does and does not know about zones. */
function zoneNote(events: readonly CalendarEvent[]): string | null {
  const timed = events.filter((one) => one.start.time !== null)
  if (timed.length === 0) return 'Every event covers a whole day, so there is no time of day and no time zone in the file.'
  const floating = timed.filter((one) => !one.start.utc).length
  if (floating === timed.length) return 'The times have no time zone, so each event happens at that time on the clock of whatever computer opens the file.'
  if (floating === 0) return 'The table gave the times with a time zone, so they are written as exact moments in UTC and your calendar will show them in your own zone.'
  return `${timed.length - floating} of the ${timed.length} times came with a time zone and are written as exact moments; the other ${floating} have none and happen at that time on the clock of whatever computer opens the file.`
}

/**
 * One event per row of a table.
 *
 * A row whose date cannot be read is left out, and how many were left out is said in words rather than left for
 * somebody to notice from a count that does not add up. A table with no date column is refused: there is nothing
 * honest to put in a calendar.
 */
export function eventsFromTable(
  table: Table,
  options: { now: number; columns?: Partial<CalendarColumnChoice>; defaultTitle?: string }
): CalendarBuild | CalendarError {
  if (table.columns.length === 0) return { error: 'no-date', message: 'That table has no columns, so there are no dates to put in a calendar.' }
  if (table.rows.length === 0) return { error: 'no-rows', message: 'That table has no rows, so there is nothing to put in a calendar.' }

  const { chosen, problems } = chooseCalendarColumns(table, options.columns)
  if (!chosen) {
    return {
      error: 'no-date',
      message: `No column of that table holds dates Orbis can read, so it cannot become a calendar. ${DATE_SPELLINGS} ${problems.join(' ')}`.trim()
    }
  }

  const indexOf = (id: string | null): number => (id === null ? -1 : table.columns.findIndex((one) => one.id === id))
  const at = {
    date: indexOf(chosen.date),
    time: indexOf(chosen.time),
    end: indexOf(chosen.end),
    title: indexOf(chosen.title),
    place: indexOf(chosen.place),
    notes: indexOf(chosen.notes)
  }
  const textAt = (row: Row, index: number): string => {
    const column = index < 0 ? null : table.columns[index]
    if (!column) return ''
    return cellOut(row.cells[index] ?? null, column).trim()
  }

  const fallbackTitle = cut(String(options.defaultTitle ?? table.source ?? '').trim() || 'Event', CALENDAR_LIMITS.title)
  const events: CalendarEvent[] = []
  const notes: string[] = [...problems]
  let skipped = 0
  let endDropped = 0
  let shortened = 0

  const rows = table.rows.slice(0, CALENDAR_LIMITS.events)
  for (const row of rows) {
    const start = readMoment(textAt(row, at.date))
    if (!start) {
      skipped++
      continue
    }
    // A separate time column puts a clock on a day. Only when the date column did not already carry one.
    let begins = start
    if (start.time === null && at.time >= 0) {
      const clock = readClock(textAt(row, at.time))
      if (clock) begins = { date: start.date, time: clock, utc: false }
    }

    let ends: Moment | null = null
    if (at.end >= 0) {
      const raw = textAt(row, at.end)
      const asMoment = readMoment(raw)
      const asClock = asMoment ? null : readClock(raw)
      const candidate: Moment | null = asMoment ?? (asClock ? { date: begins.date, time: asClock, utc: begins.utc } : null)
      if (candidate && momentOrder(candidate) > momentOrder(begins)) ends = candidate
      else if (raw !== '') endDropped++
    }
    // The format writes a whole day as the day it does not include, so a one-day event ends the morning after.
    if (ends === null && begins.time === null) ends = { date: nextDay(begins.date), time: null, utc: false }

    const rawTitle = at.title >= 0 ? textAt(row, at.title) : ''
    const title = cut(rawTitle === '' ? fallbackTitle : rawTitle, CALENDAR_LIMITS.title)
    if (rawTitle.length > CALENDAR_LIMITS.title) shortened++
    const place = cut(at.place >= 0 ? textAt(row, at.place) : '', CALENDAR_LIMITS.place)
    const eventNotes = cut(at.notes >= 0 ? textAt(row, at.notes) : '', CALENDAR_LIMITS.notes)
    events.push({
      uid: calendarUid(`${options.now}|${table.source}|${row.id}|${begins.date}${begins.time ?? ''}|${title}`, events.length + 1),
      title,
      start: begins,
      end: ends,
      place,
      notes: eventNotes
    })
  }

  if (events.length === 0) {
    return {
      error: 'no-events',
      message: `None of the ${table.rows.length} row${table.rows.length === 1 ? '' : 's'} had a date Orbis could read without guessing. ${DATE_SPELLINGS}`
    }
  }

  const named = (id: string | null): string => {
    const column = id === null ? null : columnById(table, id)
    return column ? column.name : ''
  }
  notes.push(`The date came from "${named(chosen.date)}"${chosen.time ? `, the time from "${named(chosen.time)}"` : ''}${chosen.end ? `, the end from "${named(chosen.end)}"` : ''}${chosen.title ? `, the name from "${named(chosen.title)}"` : ''}${chosen.place ? `, the place from "${named(chosen.place)}"` : ''}${chosen.notes ? `, the notes from "${named(chosen.notes)}"` : ''}.`)
  if (!chosen.title) notes.push(`No column named the events, so each one is called "${fallbackTitle}".`)
  if (skipped > 0) notes.push(`${skipped} row${skipped === 1 ? '' : 's'} had no date Orbis could read and ${skipped === 1 ? 'was' : 'were'} left out.`)
  if (endDropped > 0) notes.push(`${endDropped} row${endDropped === 1 ? '' : 's'} had an end that was not after the start, so ${endDropped === 1 ? 'that event' : 'those events'} ${endDropped === 1 ? 'has' : 'have'} a start only.`)
  if (shortened > 0) notes.push(`${shortened} name${shortened === 1 ? ' was' : 's were'} longer than ${CALENDAR_LIMITS.title} characters and ${shortened === 1 ? 'was' : 'were'} shortened.`)
  if (table.rows.length > rows.length) notes.push(`The table has ${table.rows.length} rows; the first ${rows.length} were written.`)
  const zone = zoneNote(events)
  if (zone) notes.push(zone)

  return { events, chosen, skipped, notes }
}

/** One event, from a title and a date somebody typed rather than from a table. */
export function singleCalendarEvent(request: {
  title: string
  date: string
  time?: string
  end?: string
  place?: string
  notes?: string
  now: number
}): CalendarEvent | CalendarError {
  const title = cut(String(request.title ?? '').trim(), CALENDAR_LIMITS.title)
  if (title === '') return { error: 'invalid-argument', message: 'An event needs a name.' }
  const start = readMoment(request.date)
  if (!start) {
    return {
      error: 'parse',
      message: `"${String(request.date ?? '').slice(0, 60)}" is not a date Orbis can read without guessing. ${DATE_SPELLINGS}`
    }
  }
  let begins = start
  if (start.time === null && request.time) {
    const clock = readClock(request.time)
    if (!clock) return { error: 'parse', message: `"${String(request.time).slice(0, 30)}" is not a time Orbis can read. Write it as 09:30, or as 9am.` }
    begins = { date: start.date, time: clock, utc: false }
  }
  let ends: Moment | null = null
  if (request.end) {
    const asMoment = readMoment(request.end)
    const asClock = asMoment ? null : readClock(request.end)
    const candidate: Moment | null = asMoment ?? (asClock ? { date: begins.date, time: asClock, utc: begins.utc } : null)
    if (!candidate) return { error: 'parse', message: `"${String(request.end).slice(0, 30)}" is not an end Orbis can read.` }
    if (momentOrder(candidate) <= momentOrder(begins)) return { error: 'invalid-argument', message: 'The end is not after the start.' }
    ends = candidate
  }
  if (ends === null && begins.time === null) ends = { date: nextDay(begins.date), time: null, utc: false }
  return {
    uid: calendarUid(`${request.now}|${title}|${begins.date}${begins.time ?? ''}`, 1),
    title,
    start: begins,
    end: ends,
    place: cut(String(request.place ?? '').trim(), CALENDAR_LIMITS.place),
    notes: cut(String(request.notes ?? '').trim(), CALENDAR_LIMITS.notes)
  }
}

// ---------------------------------------------------------------- writing the file

/** A backslash, a semicolon, a comma and a line break all end a value early unless they are escaped. */
export const escapeIcsText = (value: string): string =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')

const unescapeIcsText = (value: string): string => {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\\') {
      out += value[i]
      continue
    }
    const next = value[++i]
    if (next === 'n' || next === 'N') out += '\n'
    else if (next === undefined) out += '\\'
    else out += next
  }
  return out
}

/**
 * One line, folded into lines no longer than 75 octets each.
 *
 * Counted in octets, not characters, because the limit in the format is on bytes and a line of 70 accented letters is
 * 140 of them. A fold never falls inside a character: the split walks back off any continuation byte first, or the
 * file would hold a broken character that no reader can decode. Every piece after the first begins with the one space
 * that marks it as a continuation, and that space counts towards its 75 -- so what comes back can be joined with a
 * line ending and nothing else.
 */
export function foldIcsLine(line: string): string[] {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= CALENDAR_LIMITS.line) return [line]
  const decoder = new TextDecoder()
  const out: string[] = []
  let at = 0
  while (at < bytes.length) {
    const first = out.length === 0
    const room = first ? CALENDAR_LIMITS.line : CALENDAR_LIMITS.line - 1
    let end = Math.min(bytes.length, at + room)
    while (end > at + 1 && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
    out.push(`${first ? '' : ' '}${decoder.decode(bytes.subarray(at, end))}`)
    at = end
  }
  return out
}

const momentValue = (moment: Moment): { parameters: string; value: string } =>
  moment.time === null
    ? { parameters: ';VALUE=DATE', value: moment.date }
    : { parameters: '', value: `${moment.date}T${moment.time}${moment.utc ? 'Z' : ''}` }

/** The moment a file was written, as the format writes it: always UTC, because that is what DTSTAMP means. */
function stampOf(now: number): string {
  const at = new Date(now)
  return `${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1, 2)}${pad(at.getUTCDate(), 2)}T${pad(at.getUTCHours(), 2)}${pad(at.getUTCMinutes(), 2)}${pad(at.getUTCSeconds(), 2)}Z`
}

/**
 * The events as an iCalendar file.
 *
 * Every line ends CRLF, which the format requires and which is not what a text editor on this computer does by
 * default -- so the bytes are built here rather than joined with newlines anywhere else.
 */
export function writeIcs(events: readonly CalendarEvent[], options: { now: number; name?: string }): CalendarFile | CalendarError {
  if (events.length === 0) return { error: 'no-events', message: 'There are no events to write.' }
  const dtstamp = stampOf(options.now)
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Orbis//Orbis Create//EN', 'CALSCALE:GREGORIAN']
  const name = String(options.name ?? '').trim()
  // Not part of RFC 5545, but it is what every calendar program reads to name an imported file, and it is true.
  if (name !== '') lines.push(`X-WR-CALNAME:${escapeIcsText(cut(name, CALENDAR_LIMITS.title))}`)

  for (const event of events.slice(0, CALENDAR_LIMITS.events)) {
    const start = momentValue(event.start)
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${event.uid}`)
    lines.push(`DTSTAMP:${dtstamp}`)
    lines.push(`DTSTART${start.parameters}:${start.value}`)
    if (event.end) {
      const end = momentValue(event.end)
      lines.push(`DTEND${end.parameters}:${end.value}`)
    }
    lines.push(`SUMMARY:${escapeIcsText(event.title)}`)
    if (event.place !== '') lines.push(`LOCATION:${escapeIcsText(event.place)}`)
    if (event.notes !== '') lines.push(`DESCRIPTION:${escapeIcsText(event.notes)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')

  const text = `${lines.flatMap(foldIcsLine).join('\r\n')}\r\n`
  const bytes = new TextEncoder().encode(text)
  return { text, bytes, hash: hashOf(bytes), events: Math.min(events.length, CALENDAR_LIMITS.events) }
}

// ---------------------------------------------------------------- reading it back

export interface ParsedCalendar {
  name: string | null
  events: { uid: string; title: string; start: Moment | null; end: Moment | null; place: string; notes: string }[]
  problems: string[]
}

/** Folded lines joined again. A continuation is a line beginning with one space or one tab, and that character goes. */
export function unfoldIcs(text: string): string[] {
  const out: string[] = []
  for (const line of text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) out[out.length - 1] += line.slice(1)
    else out.push(line)
  }
  return out.filter((one) => one !== '')
}

/**
 * A calendar file read back.
 *
 * This exists to check what was written, so it reads what this file writes and no more: no recurrence, no alarms, no
 * zone definitions, no attendees. A property it does not know is skipped rather than guessed at.
 */
export function readIcs(source: string | Uint8Array): ParsedCalendar | CalendarError {
  const text = typeof source === 'string' ? source : new TextDecoder('utf-8', { fatal: false }).decode(source)
  const lines = unfoldIcs(text)
  if (lines[0] !== 'BEGIN:VCALENDAR') return { error: 'parse', message: 'That file does not begin as a calendar file does.' }
  if (!lines.includes('END:VCALENDAR')) return { error: 'parse', message: 'The calendar file is cut short: it never ends.' }

  const problems: string[] = []
  const events: ParsedCalendar['events'] = []
  let name: string | null = null
  let open: ParsedCalendar['events'][number] | null = null

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      open = { uid: '', title: '', start: null, end: null, place: '', notes: '' }
      continue
    }
    if (line === 'END:VEVENT') {
      if (open) events.push(open)
      open = null
      continue
    }
    const split = line.indexOf(':')
    if (split < 0) continue
    const left = line.slice(0, split)
    const value = line.slice(split + 1)
    const propertyName = left.split(';')[0].toUpperCase()
    if (!open) {
      if (propertyName === 'X-WR-CALNAME') name = unescapeIcsText(value)
      continue
    }
    switch (propertyName) {
      case 'UID':
        open.uid = value
        break
      case 'SUMMARY':
        open.title = unescapeIcsText(value)
        break
      case 'LOCATION':
        open.place = unescapeIcsText(value)
        break
      case 'DESCRIPTION':
        open.notes = unescapeIcsText(value)
        break
      case 'DTSTART':
      case 'DTEND': {
        const moment = readMoment(value)
        if (!moment) problems.push(`${propertyName} "${value.slice(0, 40)}" could not be read.`)
        else if (propertyName === 'DTSTART') open.start = moment
        else open.end = moment
        break
      }
      default:
        break
    }
  }
  if (open) problems.push('An event in the file never ends.')
  return { name, events, problems }
}

const sameMoment = (a: Moment | null, b: Moment | null): boolean =>
  a === null || b === null ? a === b : a.date === b.date && a.time === b.time && a.utc === b.utc

/**
 * The written file, read back and compared with the events it was written from.
 *
 * Not "it parses": every event's identifier, name, start and end are compared, because a calendar file that parses
 * and holds the wrong day is the failure nobody notices until the meeting is missed.
 */
export function verifyIcsFile(
  events: readonly CalendarEvent[],
  readBack: Uint8Array,
  expected?: { bytes: number; hash: string }
): VerifyResult {
  const checks: VerifyResult['checks'] = []
  const differences: string[] = []
  if (expected) {
    checks.push({
      what: 'written',
      passed: readBack.length === expected.bytes,
      describe: `The file on disk is ${readBack.length} bytes; ${expected.bytes} was written.`
    })
    checks.push({
      what: 'checksum',
      passed: hashOf(readBack) === expected.hash,
      describe: 'The hash of the file on disk matches the one recorded when it was written.'
    })
  }

  const parsed = readIcs(readBack)
  if (isCalendarError(parsed)) {
    checks.push({ what: 'calendar', passed: false, describe: `The file could not be read back as a calendar: ${parsed.message}` })
    return { ok: false, checks, reimported: null, differences }
  }
  const wrote = events.slice(0, CALENDAR_LIMITS.events)
  checks.push({ what: 'calendar', passed: true, describe: 'The file reads back as a calendar file.' })
  checks.push({
    what: 'events',
    passed: parsed.events.length === wrote.length,
    describe: `Reading the file back gives ${parsed.events.length} event${parsed.events.length === 1 ? '' : 's'}; ${wrote.length} ${wrote.length === 1 ? 'was' : 'were'} written.`
  })

  let wrong = 0
  const count = Math.min(parsed.events.length, wrote.length)
  for (let i = 0; i < count; i++) {
    const made = wrote[i]
    const back = parsed.events[i]
    if (back.uid !== made.uid) differences.push(`Event ${i + 1}: the identifier read back as "${back.uid}".`)
    if (back.title !== made.title) differences.push(`Event ${i + 1}: the name read back as "${back.title}" rather than "${made.title}".`)
    if (!sameMoment(back.start, made.start)) differences.push(`Event ${i + 1} ("${made.title}"): the start read back as a different moment.`)
    if (!sameMoment(back.end, made.end)) differences.push(`Event ${i + 1} ("${made.title}"): the end read back as a different moment.`)
    if (back.place !== made.place || back.notes !== made.notes) differences.push(`Event ${i + 1} ("${made.title}"): the place or the notes read back differently.`)
    if (back.uid !== made.uid || back.title !== made.title || !sameMoment(back.start, made.start) || !sameMoment(back.end, made.end) || back.place !== made.place || back.notes !== made.notes) wrong++
  }
  checks.push({
    what: 'round trip',
    passed: wrong === 0,
    describe: wrong === 0 ? `All ${count} event${count === 1 ? '' : 's'} read back with the same name, start and end.` : `${wrong} of the ${count} events read back differently.`
  })
  for (const problem of parsed.problems) differences.push(problem)

  return {
    ok: checks.every((one) => one.passed) && parsed.problems.length === 0,
    checks,
    reimported: { rows: parsed.events.length, columns: 0 },
    differences
  }
}

/** The words shown beside a calendar file. Orbis hands the file over; it does not put anything on a calendar. */
export function calendarHandoverNote(events: number): string {
  return `${events} event${events === 1 ? '' : 's'} written to a calendar file. Open it and your own calendar program will offer to add ${events === 1 ? 'it' : 'them'} -- Orbis has no connection to your calendar, so it cannot add ${events === 1 ? 'it' : 'them'} for you and will never know whether you did.`
}
