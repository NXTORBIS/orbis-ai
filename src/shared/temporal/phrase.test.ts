import assert from 'node:assert/strict'
import test from 'node:test'
import { clockText, describeRecurrence, looksLikeScheduleRequest, readRequest, readTime } from './phrase.ts'
import { nextOccurrence, type Recurrence } from './recurrence.ts'

type Weekly = Extract<Recurrence, { kind: 'weekly' }>

/**
 * Schedules said in words.
 *
 * Half of these are about what is *refused*. That is deliberate: a parser that stretches to cover every sentence is
 * how "every other Tuesday" becomes every Tuesday, and nobody finds out until they have been reminded twice as often
 * as they asked for.
 */

// A Monday at midday, UTC, so every relative phrase below has a fixed answer.
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0)
const UTC = 'UTC'

const read = (phrase: string) => readRequest(phrase, NOW, UTC)

// ---------------------------------------------------------------- times of day

test('times said the ordinary ways', () => {
  assert.deepEqual(readTime('9am'), { hour: 9, minute: 0 })
  assert.deepEqual(readTime('9 pm'), { hour: 21, minute: 0 })
  assert.deepEqual(readTime('18:30'), { hour: 18, minute: 30 })
  assert.deepEqual(readTime('noon'), { hour: 12, minute: 0 })
  assert.deepEqual(readTime('midnight'), { hour: 0, minute: 0 })
  assert.deepEqual(readTime('12am'), { hour: 0, minute: 0 }, 'midnight, not midday')
  assert.deepEqual(readTime('12pm'), { hour: 12, minute: 0 }, 'midday, not midnight')
})

test('times said in speech', () => {
  assert.deepEqual(readTime('half past nine'), { hour: 9, minute: 30 })
  assert.deepEqual(readTime('quarter past 6'), { hour: 6, minute: 15 })
  // "Quarter to six" is a quarter of an hour before six, which is in the hour before it.
  assert.deepEqual(readTime('quarter to six'), { hour: 5, minute: 45 })
  assert.deepEqual(readTime('half past nine pm'), { hour: 21, minute: 30 })
})

test('nonsense times are refused rather than rounded', () => {
  for (const bad of ['25:00', '9:70', '13pm', 'soon', 'later', 'sometime', '']) {
    assert.equal(readTime(bad), null, bad)
  }
})

test('a bare hour is taken literally and said back, so it can be corrected', () => {
  const r = read('remind me to stretch at 7')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.match(r.said, /7am/)
})

// ---------------------------------------------------------------- the rules

test('every day', () => {
  const r = read('open news.example every day at 8am')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(r.schedule.recurrence, { kind: 'daily', time: { hour: 8, minute: 0 } })
  assert.deepEqual(r.action, { kind: 'openUrl', url: 'https://news.example', newTab: true })
})

test('weekdays and weekends, which people say more often than the days', () => {
  const week = read('open mail.example every weekday at 9')
  assert.equal(week.ok, true)
  if (!week.ok) return
  assert.deepEqual(week.schedule.recurrence, { kind: 'weekly', weekdays: [1, 2, 3, 4, 5], time: { hour: 9, minute: 0 } })

  const end = read('remind me to rest on weekends at 10am')
  assert.equal(end.ok, true)
  if (!end.ok) return
  assert.deepEqual([...(end.schedule.recurrence as Weekly).weekdays], [0, 6])
})

test('several named days at once', () => {
  const r = read('remind me to take the bins out every monday and thursday at 7pm')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual([...(r.schedule.recurrence as Weekly).weekdays], [1, 4])
  assert.deepEqual((r.schedule.recurrence as { time: unknown }).time, { hour: 19, minute: 0 })
})

test('every so many minutes or hours', () => {
  const half = read('refresh status.example every 30 minutes')
  assert.equal(half.ok, true)
  if (!half.ok) return
  assert.deepEqual(half.schedule.recurrence, { kind: 'interval', everyMinutes: 30, from: NOW })
  assert.equal(half.action.kind, 'refreshUrl')

  const hours = read('remind me to drink water every 2 hours')
  assert.equal(hours.ok, true)
  if (!hours.ok) return
  assert.equal((hours.schedule.recurrence as { everyMinutes: number }).everyMinutes, 120)

  const hourly = read('refresh status.example hourly')
  assert.equal(hourly.ok, true)
})

test('monthly, including a day the short months do not have', () => {
  const first = read('remind me to pay rent every month on the 1st at 9am')
  assert.equal(first.ok, true)
  if (!first.ok) return
  assert.equal((first.schedule.recurrence as { day: number }).day, 1)

  /**
   * The 31st is accepted, which the older parser refused outright.
   *
   * Refusing it is not wrong so much as unhelpful -- people do get paid on the 31st. It is kept as asked and the
   * short-month rule moves it to the end of February rather than into March.
   */
  const last = read('remind me to check the books every month on the 31st at 6pm')
  assert.equal(last.ok, true)
  if (!last.ok) return
  assert.equal((last.schedule.recurrence as { day: number }).day, 31)
  const feb = nextOccurrence(last.schedule, Date.UTC(2027, 1, 1))
  assert.ok(feb)
  assert.equal(new Date(feb.at).getUTCMonth(), 1, 'still February')
  assert.equal(new Date(feb.at).getUTCDate(), 28, 'moved to the end of it, not into March')
})

test('the last day of the month', () => {
  const r = read('remind me to do the invoices on the last day of the month at 5pm')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.schedule.recurrence.kind, 'monthlyLastDay')
})

test('every year', () => {
  const r = read('remind me to renew the domain every year on 3 march at 10am')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(r.schedule.recurrence, { kind: 'yearly', month: 3, day: 3, time: { hour: 10, minute: 0 }, short: 'lastDay' })
})

// ---------------------------------------------------------------- one-offs

test('in twenty minutes', () => {
  const r = read('remind me to check the oven in 20 minutes')
  assert.equal(r.ok, true)
  if (!r.ok) return
  const at = nextOccurrence(r.schedule, NOW)
  assert.ok(at)
  // To the minute, since a wall time has no seconds.
  assert.equal(at.at, NOW + 20 * 60_000)
  assert.deepEqual(r.action, { kind: 'notify', message: 'Check the oven' })
})

test('tomorrow, and tonight', () => {
  const tomorrow = read('remind me to call the dentist tomorrow at 9am')
  assert.equal(tomorrow.ok, true)
  if (!tomorrow.ok) return
  const at = nextOccurrence(tomorrow.schedule, NOW)
  assert.equal(at?.at, Date.UTC(2026, 5, 16, 9, 0))

  const tonight = read('remind me to lock up tonight')
  assert.equal(tonight.ok, true)
  if (!tonight.ok) return
  // No time given, so an evening default and it is said back as one.
  assert.equal(tonight.assumedTime, true)
  assert.equal((tonight.schedule.recurrence as { time: { hour: number } }).time.hour, 20)
})

test('next monday', () => {
  const r = read('remind me to send the report next monday at 8am')
  assert.equal(r.ok, true)
  if (!r.ok) return
  // Today is a Monday, so "next Monday" is the one after, never today.
  const at = nextOccurrence(r.schedule, NOW)
  assert.equal(at?.at, Date.UTC(2026, 5, 22, 8, 0))
})

test('a bare time means the next one of those', () => {
  const soon = read('remind me to stretch at 6pm')
  assert.equal(soon.ok, true)
  if (!soon.ok) return
  assert.equal(nextOccurrence(soon.schedule, NOW)?.at, Date.UTC(2026, 5, 15, 18, 0), 'today')

  const past = read('remind me to stretch at 8am')
  assert.equal(past.ok, true)
  if (!past.ok) return
  assert.equal(nextOccurrence(past.schedule, NOW)?.at, Date.UTC(2026, 5, 16, 8, 0), 'tomorrow, since 8am has gone')
})

// ---------------------------------------------------------------- places

test('a schedule can be in a place other than where the computer is', () => {
  const r = readRequest('remind me to join the call every weekday at 9am new york time', NOW, UTC)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.schedule.timeZone, 'America/New_York')
  // Which is 13:00 UTC in June, and the point is that it stays 9am there when the clocks change.
  const at = nextOccurrence(r.schedule, NOW)
  assert.equal(new Date(at!.at).getUTCHours(), 13)
})

test('IST is understood, and so is a full zone name', () => {
  const ist = readRequest('remind me to call home every day at 8pm ist', NOW, UTC)
  assert.equal(ist.ok, true)
  if (!ist.ok) return
  assert.equal(ist.schedule.timeZone, 'Asia/Kolkata')

  const named = readRequest('remind me to stretch every day at 9am in Europe/Berlin', NOW, UTC)
  assert.equal(named.ok, true)
  if (!named.ok) return
  assert.equal(named.schedule.timeZone, 'Europe/Berlin')
})

test('a zone this computer does not know is refused, not treated as UTC', () => {
  const r = readRequest('remind me to stretch every day at 9am', NOW, 'Mars/Olympus_Mons')
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.why, /does not know the time zone/)
})

// ---------------------------------------------------------------- limits

test('a number of times', () => {
  const r = read('remind me to take the tablets every day at 9am for 10 times')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.schedule.maxRuns, 10)
})

test('only once', () => {
  const r = read('open news.example every day at 8am only once')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.schedule.maxRuns, 1)
})

test('until a day', () => {
  const r = read('remind me to revise every day at 7pm until friday')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.ok(r.schedule.endsAt !== undefined)
  // Friday the 19th, and the end of it rather than its start, because "until Friday" includes Friday.
  assert.ok(r.schedule.endsAt! > Date.UTC(2026, 5, 19, 19, 0))
})

// ---------------------------------------------------------------- conditions

test('only on wifi, only on power', () => {
  const r = read('refresh status.example every hour only on wifi when plugged in')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual([...r.conditions].map((c) => c.kind).sort(), ['onPower', 'onWifi'])
})

// ---------------------------------------------------------------- what it refuses

test('a rule Orbis cannot keep is refused rather than approximated', () => {
  for (const phrase of [
    'remind me to water the plants every other tuesday at 9am',
    'remind me to pay in every fortnight at 9am',
    'remind me to go out when the weather is nice',
    'open news.example whenever i feel like it'
  ]) {
    const r = read(phrase)
    assert.equal(r.ok, false, phrase)
  }
})

test('a sentence with a time but nothing to do is refused, not turned into a note', () => {
  /**
   * The temptation is to make it a reminder saying whatever was left over. That is a scheduler pretending to have
   * understood, and the person finds out when a reminder arrives that reads like half a sentence.
   */
  const r = read('every day at 8am')
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.why, /not what to do/)
})

test('a sentence with something to do but no time is refused', () => {
  const r = read('open news.example')
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.why, /could not find a time/)
})

test('nothing at all is refused', () => {
  assert.equal(read('   ').ok, false)
})

test('things Orbis genuinely cannot do are answered about Orbis, not about grammar', () => {
  const whats = read('send a whatsapp to mum every sunday at 6pm')
  assert.equal(whats.ok, false)
  if (whats.ok) return
  assert.ok('unsupported' in whats)
  assert.match(whats.why, /no connection to any messaging service/)

  const mail = read('email the team every monday at 9am')
  assert.equal(mail.ok, false)
  if (mail.ok) return
  assert.match(mail.why, /no mail account/)

  const money = read('buy 10 bitcoin every friday at 9am')
  assert.equal(money.ok, false)
  if (money.ok) return
  assert.match(money.why, /will not move money/)
})

test('a schedule is never a way to run a command', () => {
  // There is nowhere in the model to put one, so the sentence simply has nothing to do in it.
  for (const phrase of ['run rm -rf / every day at 3am', 'execute powershell every hour', 'run the script every night']) {
    const r = read(phrase)
    assert.equal(r.ok, false, phrase)
  }
})

test('an interval below a minute is refused', () => {
  // Below a minute a schedule stops being a schedule and becomes a loop.
  const r = read('refresh status.example every 0 minutes')
  assert.equal(r.ok, false)
})

// ---------------------------------------------------------------- saying it back

test('what Orbis understood is said back in the same words somebody would use', () => {
  const r = read('open news.example every weekday at 8am')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.match(r.said, /^Open news\.example/)
  assert.match(r.said, /Monday, Tuesday, Wednesday, Thursday and Friday/)
  assert.match(r.said, /8am/)
})

test('a place is said back when it is not where the computer is', () => {
  const r = readRequest('remind me to join the call every day at 9am new york time', NOW, UTC)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.match(r.said, /New York time/)
})

test('the rules read back as sentences', () => {
  assert.equal(describeRecurrence({ kind: 'daily', time: { hour: 8, minute: 30 } }), 'every day at 8:30am')
  assert.equal(describeRecurrence({ kind: 'interval', everyMinutes: 120, from: 0 }), 'every 2 hours')
  assert.equal(describeRecurrence({ kind: 'interval', everyMinutes: 15, from: 0 }), 'every 15 minutes')
  assert.equal(describeRecurrence({ kind: 'monthlyLastDay', time: { hour: 17, minute: 0 } }), 'on the last day of every month at 5pm')
  assert.equal(
    describeRecurrence({ kind: 'monthly', day: 3, time: { hour: 9, minute: 0 }, short: 'lastDay' }),
    'every month on the 3rd at 9am'
  )
  assert.equal(clockText({ hour: 0, minute: 0 }), '12am')
  assert.equal(clockText({ hour: 12, minute: 0 }), '12pm')
})

test('an assumed time is flagged, so the confirmation can say it was assumed', () => {
  const assumed = read('open news.example every morning')
  assert.equal(assumed.ok, true)
  if (!assumed.ok) return
  assert.equal(assumed.assumedTime, true)
  assert.equal((assumed.schedule.recurrence as { time: { hour: number } }).time.hour, 8)

  const given = read('open news.example every day at 6am')
  assert.equal(given.ok, true)
  if (!given.ok) return
  assert.equal(given.assumedTime, false)
})

test('every reading produces a schedule the scheduler will actually accept', () => {
  // The parser and the checker agreeing is what stops an unusable rule being stored.
  const phrases = [
    'open news.example every day at 8am',
    'remind me to stretch every hour',
    'remind me to pay rent every month on the 31st at 9am',
    'remind me to renew the domain every year on 3 march at 10am',
    'open mail.example every weekday at 9',
    'remind me to check the oven in 20 minutes',
    'remind me to call the dentist tomorrow at 9am',
    'remind me to do the invoices on the last day of the month at 5pm'
  ]
  for (const phrase of phrases) {
    const r = read(phrase)
    assert.equal(r.ok, true, phrase)
    if (!r.ok) continue
    assert.ok(nextOccurrence(r.schedule, NOW) !== null, `${phrase} has a next occurrence`)
  }
})

// ---------------------------------------------------------------- telling a request from a remark

test('a message that mentions a time in passing is not a request for a schedule', () => {
  /**
   * The gate that keeps the chat path honest. Each of these has a rule and an action somewhere in it, and turning
   * any of them into a schedule is a surprise somebody discovers the next morning.
   */
  for (const remark of [
    'every day I open news.example and it is slow',
    'I used to refresh status.example every 30 minutes but I stopped',
    'why does orbis open news.example every morning',
    'the meeting is every monday at 9am, is that in my calendar',
    'thanks, that worked'
  ]) {
    assert.equal(looksLikeScheduleRequest(remark), false, remark)
  }
})

test('a message that begins like a request is treated as one', () => {
  for (const request of [
    'remind me to stretch every hour',
    'every weekday at 8am open news.example',
    'please remind me to pay rent every month on the 1st',
    'open news.example every morning',
    'in 20 minutes remind me to check the oven',
    'tomorrow at 9am remind me to call the dentist'
  ]) {
    assert.equal(looksLikeScheduleRequest(request), true, request)
  }
})

test('a paragraph that happens to start with a rule is prose, not an instruction', () => {
  const essay = 'every day at 8am ' + 'something happens and then a great deal more happens after that, '.repeat(6)
  assert.equal(looksLikeScheduleRequest(essay), false)
})

test('a zone is not called out when it is the same place under another name', () => {
  /**
   * A computer in India resolves its own zone as "Asia/Calcutta"; somebody saying "IST" means "Asia/Kolkata". They
   * are the same place, so tagging the schedule "(Kolkata time)" there reads as though a conversion had happened.
   */
  const r = readRequest('remind me to call home every day at 8pm ist', NOW, 'Asia/Calcutta')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.ok(!r.said.includes('time)'), r.said)

  // Somewhere genuinely different is still said.
  const far = readRequest('remind me to join the call every day at 9am new york time', NOW, 'Asia/Calcutta')
  assert.equal(far.ok, true)
  if (!far.ok) return
  assert.match(far.said, /New York time/)
})
