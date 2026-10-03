import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDataError, parseDelimited, type Table } from '../compute/data.ts'
import { hashOf } from '../compute/interchange.ts'
import {
  CALENDAR_LIMITS,
  calendarHandoverNote,
  chooseCalendarColumns,
  escapeIcsText,
  eventsFromTable,
  foldIcsLine,
  isCalendarError,
  momentOrder,
  nextDay,
  readClock,
  readIcs,
  readMoment,
  singleCalendarEvent,
  unfoldIcs,
  verifyIcsFile,
  writeIcs
} from './calendar.ts'

/*
 * Real tables parsed by the real table engine, written as real calendar files and read back by the real reader.
 * Nothing is stubbed: every fixture here is text a person could have pasted.
 */

const NOW = Date.UTC(2026, 9, 3, 11, 30, 15)

const tableOf = (text: string): Table => {
  const parsed = parseDelimited(text)
  if (isDataError(parsed)) throw new Error(parsed.message)
  return parsed.table
}

const buildOf = (text: string, options: Parameters<typeof eventsFromTable>[1] = { now: NOW }) => {
  const built = eventsFromTable(tableOf(text), options)
  if (isCalendarError(built)) throw new Error(built.message)
  return built
}

const fileOf = (text: string, options: Parameters<typeof eventsFromTable>[1] = { now: NOW }) => {
  const built = buildOf(text, options)
  const file = writeIcs(built.events, { now: NOW, name: 'Plan' })
  if (isCalendarError(file)) throw new Error(file.message)
  return { built, file }
}

// ---------------------------------------------------------------- reading a date

test('a date is read only in the spellings that cannot be read two ways', () => {
  assert.deepEqual(readMoment('2026-10-03'), { date: '20261003', time: null, utc: false })
  assert.deepEqual(readMoment('3 October 2026'), { date: '20261003', time: null, utc: false })
  assert.deepEqual(readMoment('Oct 3, 2026'), { date: '20261003', time: null, utc: false })
  assert.deepEqual(readMoment('20261003'), { date: '20261003', time: null, utc: false })
  // The one everybody gets wrong: two different days in two different countries, so it is refused.
  assert.equal(readMoment('03/10/2026'), null)
  assert.equal(readMoment('next Tuesday'), null)
  assert.equal(readMoment(''), null)
})

test('a day that does not exist is refused rather than rolled forward', () => {
  assert.equal(readMoment('2026-02-30'), null)
  assert.equal(readMoment('2026-13-01'), null)
  assert.deepEqual(readMoment('2024-02-29'), { date: '20240229', time: null, utc: false })
  assert.equal(readMoment('2026-02-29'), null, '2026 is not a leap year')
})

test('a time with no zone floats and a time with a zone becomes the same instant in UTC', () => {
  assert.deepEqual(readMoment('2026-10-03T09:30'), { date: '20261003', time: '093000', utc: false })
  assert.deepEqual(readMoment('2026-10-03 09:30:45'), { date: '20261003', time: '093045', utc: false })
  assert.deepEqual(readMoment('2026-10-03T09:30Z'), { date: '20261003', time: '093000', utc: true })
  // +02:00 at half past nine is half past seven in UTC, and the day can move with it.
  assert.deepEqual(readMoment('2026-10-03T09:30+02:00'), { date: '20261003', time: '073000', utc: true })
  assert.deepEqual(readMoment('2026-10-03T00:30+02:00'), { date: '20261002', time: '223000', utc: true })
  assert.deepEqual(readMoment('20261003T093000Z'), { date: '20261003', time: '093000', utc: true })
})

test('a clock on its own is read, and a bare number is not', () => {
  assert.equal(readClock('09:30'), '093000')
  assert.equal(readClock('9:30'), '093000')
  assert.equal(readClock('9:30:45'), '093045')
  assert.equal(readClock('9am'), '090000')
  assert.equal(readClock('7 p.m.'), '190000')
  assert.equal(readClock('12am'), '000000')
  assert.equal(readClock('12pm'), '120000')
  assert.equal(readClock('9'), null, 'nine what?')
  assert.equal(readClock('25:00'), null)
  assert.equal(readClock('9:70'), null)
})

test('the day after is the day after, across a month and a leap day', () => {
  assert.equal(nextDay('20261003'), '20261004')
  assert.equal(nextDay('20261031'), '20261101')
  assert.equal(nextDay('20261231'), '20270101')
  assert.equal(nextDay('20240228'), '20240229')
})

test('two moments compare in the order they happen', () => {
  assert.ok(momentOrder({ date: '20261003', time: '093000', utc: false }) > momentOrder({ date: '20261003', time: null, utc: false }))
  assert.ok(momentOrder({ date: '20261004', time: null, utc: false }) > momentOrder({ date: '20261003', time: '233000', utc: false }))
})

// ---------------------------------------------------------------- which column means what

test('the date column is found by its type, and the other columns by their headings', () => {
  const table = tableOf('what,date,start time,ends,where,notes\nStandup,2026-10-03,09:30,10:00,Room 2,Bring the board\n')
  const { chosen } = chooseCalendarColumns(table)
  assert.ok(chosen)
  const named = (id: string | null) => (id === null ? null : table.columns.find((one) => one.id === id)?.name ?? null)
  assert.equal(named(chosen.date), 'date')
  assert.equal(named(chosen.time), 'start time')
  assert.equal(named(chosen.end), 'ends')
  assert.equal(named(chosen.title), 'what')
  assert.equal(named(chosen.place), 'where')
  assert.equal(named(chosen.notes), 'notes')
})

test('a column given explicitly wins, and one that is not there is reported rather than ignored', () => {
  const table = tableOf('name,day,other\nReview,2026-10-03,2026-11-01\n')
  const chosenByHand = chooseCalendarColumns(table, { date: table.columns[2].id })
  assert.equal(chosenByHand.chosen?.date, table.columns[2].id)
  const missing = chooseCalendarColumns(table, { place: 'nothing_like_that' })
  assert.deepEqual(missing.problems, ['There is no column called "nothing_like_that" to use as the place.'])
  assert.equal(missing.chosen?.place, null, 'a place that is not there is left empty, not guessed at')
})

test('no column of dates means no calendar, said in words', () => {
  const refused = eventsFromTable(tableOf('name,amount\nPaper,12\nInk,30\n'), { now: NOW })
  assert.ok(isCalendarError(refused))
  assert.equal(refused.error, 'no-date')
  assert.match(refused.message, /no column of that table holds dates/i)
})

test('a table whose only dates are ambiguous is refused with the reason, not half-read', () => {
  const refused = eventsFromTable(tableOf('name,date\nReview,03/10/2026\nPlan,04/10/2026\n'), { now: NOW })
  assert.ok(isCalendarError(refused))
  assert.equal(refused.error, 'no-date')
  assert.match(refused.message, /two different days in two different countries/)
  assert.match(refused.message, /2026-10-03/, 'the refusal says what to write instead')
})

// ---------------------------------------------------------------- one event per row

test('a date with no time becomes a whole day whose end is the morning after', () => {
  const { built, file } = fileOf('what,date\nAudit,2026-10-03\n')
  assert.equal(built.events.length, 1)
  assert.deepEqual(built.events[0].start, { date: '20261003', time: null, utc: false })
  assert.deepEqual(built.events[0].end, { date: '20261004', time: null, utc: false })
  assert.match(file.text, /DTSTART;VALUE=DATE:20261003\r\n/)
  assert.match(file.text, /DTEND;VALUE=DATE:20261004\r\n/)
})

test('a separate time column puts a clock on the day', () => {
  const { built, file } = fileOf('what,date,time\nStandup,2026-10-03,09:30\n')
  assert.deepEqual(built.events[0].start, { date: '20261003', time: '093000', utc: false })
  assert.equal(built.events[0].end, null, 'no end column, so no end is invented')
  assert.match(file.text, /DTSTART:20261003T093000\r\n/)
  assert.ok(!file.text.includes('DTEND'), 'an end nobody gave is not written')
})

test('an end that is not after the start is left off and counted in words', () => {
  // Every time here carries a zone, so this test says the same thing on a machine set to any zone.
  const built = buildOf('what,date,ends\nReview,2026-10-03T09:00Z,2026-10-03T08:00Z\nPlan,2026-10-04T09:00Z,2026-10-04T10:00Z\n')
  assert.deepEqual(built.events[0].start, { date: '20261003', time: '090000', utc: true })
  assert.equal(built.events[0].end, null)
  assert.deepEqual(built.events[1].end, { date: '20261004', time: '100000', utc: true })
  assert.ok(built.notes.some((one) => /not after the start/.test(one)), built.notes.join(' | '))
})

test('rows without a readable date are left out and counted in words', () => {
  const built = buildOf('what,date\nAudit,2026-10-03\nSometime,later\nPlan,2026-10-05\nUnknown,\n')
  assert.equal(built.events.length, 2)
  assert.equal(built.skipped, 2)
  assert.ok(built.notes.some((one) => one.includes('2 rows had no date Orbis could read')), built.notes.join(' | '))
})

test('no column names the events, so the words say what each one is called instead', () => {
  const built = buildOf('date\n2026-10-03\n2026-10-04\n', { now: NOW, defaultTitle: 'Delivery window' })
  assert.deepEqual(built.events.map((one) => one.title), ['Delivery window', 'Delivery window'])
  assert.ok(built.notes.some((one) => one.includes('No column named the events')), built.notes.join(' | '))
})

test('the note says which column meant what and what the file knows about zones', () => {
  const floating = buildOf('what,date,time\nStandup,2026-10-03,09:30\n')
  assert.ok(floating.notes.some((one) => one.includes('The date came from "date"')), floating.notes.join(' | '))
  assert.ok(floating.notes.some((one) => /no time zone/.test(one)), floating.notes.join(' | '))

  const exact = buildOf('what,date\nCall,2026-10-03T09:30Z\n')
  assert.ok(exact.notes.some((one) => /exact moments in UTC/.test(one)), exact.notes.join(' | '))

  const allDay = buildOf('what,date\nAudit,2026-10-03\n')
  assert.ok(allDay.notes.some((one) => /whole day/.test(one)), allDay.notes.join(' | '))

  // One row gave an exact moment in the date column; the other gave a day and a clock, which has no zone at all.
  const mixed = buildOf('what,date,time\nCall,2026-10-03T09:30Z,\nStandup,2026-10-04,09:30\n')
  assert.deepEqual(mixed.events.map((one) => one.start.utc), [true, false])
  assert.ok(mixed.notes.some((one) => /1 of the 2 times came with a time zone/.test(one)), mixed.notes.join(' | '))
})

test('the same table written twice gives the same identifiers, so a calendar updates rather than duplicates', () => {
  const first = buildOf('what,date\nAudit,2026-10-03\n')
  const second = buildOf('what,date\nAudit,2026-10-03\n')
  assert.deepEqual(first.events.map((one) => one.uid), second.events.map((one) => one.uid))
  const later = buildOf('what,date\nAudit,2026-10-03\n', { now: NOW + 1000 })
  assert.notDeepEqual(first.events.map((one) => one.uid), later.events.map((one) => one.uid))
})

test('a single event comes from a title and a date, and a date it cannot read is refused with what to write instead', () => {
  const made = singleCalendarEvent({ title: 'Dentist', date: '2026-10-03', time: '9:15', end: '10:00', place: 'High Street', now: NOW })
  assert.ok(!isCalendarError(made))
  assert.deepEqual(made.start, { date: '20261003', time: '091500', utc: false })
  assert.deepEqual(made.end, { date: '20261003', time: '100000', utc: false })
  assert.equal(made.place, 'High Street')

  const refused = singleCalendarEvent({ title: 'Dentist', date: 'tuesday', now: NOW })
  assert.ok(isCalendarError(refused))
  assert.match(refused.message, /2026-10-03/)

  const backwards = singleCalendarEvent({ title: 'Dentist', date: '2026-10-03T10:00', end: '09:00', now: NOW })
  assert.ok(isCalendarError(backwards))
  assert.match(backwards.message, /not after the start/)

  const unnamed = singleCalendarEvent({ title: '  ', date: '2026-10-03', now: NOW })
  assert.ok(isCalendarError(unnamed))
})

// ---------------------------------------------------------------- the file itself

test('the file is a calendar file: CRLF everywhere, the envelope the format needs, and no stray newline', () => {
  const { file } = fileOf('what,date\nAudit,2026-10-03\n')
  assert.ok(file.text.startsWith('BEGIN:VCALENDAR\r\n'))
  assert.ok(file.text.endsWith('END:VCALENDAR\r\n'))
  assert.ok(file.text.includes('VERSION:2.0\r\n'))
  assert.ok(file.text.includes('PRODID:-//Orbis//Orbis Create//EN\r\n'))
  assert.ok(file.text.includes('X-WR-CALNAME:Plan\r\n'))
  assert.equal(file.text.replace(/\r\n/g, '').includes('\n'), false, 'no bare newline survives anywhere')
  assert.equal(file.hash, hashOf(file.bytes))
  assert.equal(file.events, 1)
  assert.ok(file.text.includes('UID:orbis-'))
  assert.ok(/DTSTAMP:20261003T113015Z/.test(file.text))
})

test('a comma, a semicolon, a backslash and a line break inside a title are escaped and read back whole', () => {
  assert.equal(escapeIcsText('a, b; c\\d\ne'), 'a\\, b\\; c\\\\d\\ne')
  const { built, file } = fileOf('what,date,notes\n"Review, final; v2","2026-10-03","line one\nline two"\n')
  assert.ok(file.text.includes('SUMMARY:Review\\, final\\; v2'))
  const back = readIcs(file.bytes)
  assert.ok(!isCalendarError(back))
  assert.equal(back.events[0].title, 'Review, final; v2')
  assert.equal(back.events[0].notes, 'line one\nline two')
  assert.equal(back.events[0].notes, built.events[0].notes)
})

test('a line longer than 75 octets is folded, counted in octets, and never cut through a character', () => {
  const long = `SUMMARY:${'é'.repeat(80)}`
  const folded = foldIcsLine(long)
  assert.ok(folded.length > 1)
  for (const piece of folded) assert.ok(new TextEncoder().encode(piece).length <= CALENDAR_LIMITS.line, `${new TextEncoder().encode(piece).length} octets`)
  for (const piece of folded.slice(1)) assert.ok(piece.startsWith(' '), 'a continuation line begins with one space')
  // Every piece decoded cleanly, so no fold fell inside a character.
  const joined = folded.map((piece, at) => (at === 0 ? piece : piece.slice(1))).join('')
  assert.equal(joined, long)
  assert.equal(joined.includes('�'), false)
  assert.deepEqual(foldIcsLine('SUMMARY:short'), ['SUMMARY:short'])
})

test('a folded file unfolds back to the lines it was built from', () => {
  const title = 'x'.repeat(200)
  const made = singleCalendarEvent({ title, date: '2026-10-03', now: NOW })
  assert.ok(!isCalendarError(made))
  const file = writeIcs([made], { now: NOW })
  assert.ok(!isCalendarError(file))
  assert.ok(file.text.includes('\r\n '), 'something was actually folded')
  assert.ok(unfoldIcs(file.text).includes(`SUMMARY:${title}`))
})

test('writing nothing is refused rather than producing an empty calendar', () => {
  const refused = writeIcs([], { now: NOW })
  assert.ok(isCalendarError(refused))
  assert.equal(refused.error, 'no-events')
})

// ---------------------------------------------------------------- read back and checked

test('the file read back holds the events that were written, name, start, end, place and notes', () => {
  const { built, file } = fileOf('what,date,time,ends,where,notes\nStandup,2026-10-03,09:30,10:15,Room 2,Bring the board\nAudit,2026-10-05,,,Depot,\n')
  const back = readIcs(file.text)
  assert.ok(!isCalendarError(back))
  assert.equal(back.name, 'Plan')
  assert.deepEqual(back.problems, [])
  assert.equal(back.events.length, 2)
  assert.deepEqual(back.events.map((one) => one.title), built.events.map((one) => one.title))
  assert.deepEqual(back.events[0].start, { date: '20261003', time: '093000', utc: false })
  assert.deepEqual(back.events[0].end, { date: '20261003', time: '101500', utc: false })
  assert.equal(back.events[0].place, 'Room 2')
  assert.equal(back.events[1].notes, '')
  assert.deepEqual(back.events[1].start, { date: '20261005', time: null, utc: false })
})

test('the check compares every event, not just that the file parses', () => {
  const { built, file } = fileOf('what,date,time\nStandup,2026-10-03,09:30\nAudit,2026-10-05,\n')
  const result = verifyIcsFile(built.events, file.bytes, { bytes: file.bytes.length, hash: file.hash })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.deepEqual(result.checks.map((one) => one.what), ['written', 'checksum', 'calendar', 'events', 'round trip'])
  assert.deepEqual(result.reimported, { rows: 2, columns: 0 })
  assert.deepEqual(result.differences, [])
})

test('a file whose day was changed on disk fails the check and the difference says which event', () => {
  const { built, file } = fileOf('what,date\nAudit,2026-10-03\n')
  const tampered = new TextEncoder().encode(file.text.replace('DTSTART;VALUE=DATE:20261003', 'DTSTART;VALUE=DATE:20261103'))
  const result = verifyIcsFile(built.events, tampered)
  assert.equal(result.ok, false)
  assert.equal(result.checks.find((one) => one.what === 'round trip')?.passed, false)
  assert.ok(result.differences.some((one) => /Audit/.test(one) && /start/.test(one)), result.differences.join(' | '))
})

test('a file truncated on disk fails on its size and on being a calendar at all', () => {
  const { built, file } = fileOf('what,date\nAudit,2026-10-03\n')
  const cut = file.bytes.subarray(0, 60)
  const result = verifyIcsFile(built.events, cut, { bytes: file.bytes.length, hash: file.hash })
  assert.equal(result.ok, false)
  assert.equal(result.checks.find((one) => one.what === 'written')?.passed, false)
  assert.equal(result.checks.find((one) => one.what === 'checksum')?.passed, false)
  assert.equal(result.checks.find((one) => one.what === 'calendar')?.passed, false)
})

test('something that is not a calendar file at all is refused by the reader', () => {
  const refused = readIcs('what,date\nAudit,2026-10-03\n')
  assert.ok(isCalendarError(refused))
  assert.match(refused.message, /does not begin as a calendar file/)
  const cutShort = readIcs('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')
  assert.ok(isCalendarError(cutShort))
  assert.match(cutShort.message, /never ends/)
})

test('a big table is bounded and the words say how much of it was written', () => {
  const rows = ['what,date']
  for (let i = 0; i < CALENDAR_LIMITS.events + 5; i++) rows.push(`Day ${i},2026-01-01`)
  const built = buildOf(`${rows.join('\n')}\n`)
  assert.equal(built.events.length, CALENDAR_LIMITS.events)
  assert.ok(built.notes.some((one) => one.includes(`The table has ${CALENDAR_LIMITS.events + 5} rows`)), built.notes.join(' | '))
})

test('the words beside the file say Orbis cannot add anything to a calendar and will not know whether you did', () => {
  const one = calendarHandoverNote(1)
  assert.match(one, /1 event written/)
  assert.match(one, /Orbis has no connection to your calendar/)
  assert.match(calendarHandoverNote(4), /4 events written/)
})
