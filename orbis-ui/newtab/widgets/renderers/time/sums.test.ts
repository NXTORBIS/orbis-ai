import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calculate,
  clockParts,
  countdownFigure,
  dayFraction,
  dayKey,
  handAngles,
  offsetShort,
  offsetWords,
  partOfDayAt,
  pickByKey,
  progress,
  readDay,
  span,
  sumText,
  sumValue,
  timerStanding,
  timerText,
  timeText,
  weekStrip,
  type TimerSettings
} from './sums.ts'

const at = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number => new Date(year, month - 1, day, hour, minute, second).getTime()

// ---------------------------------------------------------------- reading a moment

test('a moment is read here, and somewhere else, and refused for a place nobody knows', () => {
  const noon = at(2026, 10, 5, 12, 34, 56)
  assert.deepEqual(clockParts(noon), { hour: 12, minute: 34, second: 56, weekday: 1, day: 5, month: 10, year: 2026 })
  // The same instant in a place five and a half hours ahead of UTC, whatever this computer's own zone is.
  const kolkata = clockParts(Date.UTC(2026, 9, 5, 0, 0, 0), 'Asia/Kolkata')
  assert.deepEqual(kolkata && { hour: kolkata.hour, minute: kolkata.minute, day: kolkata.day }, { hour: 5, minute: 30, day: 5 })
  // A zone name past midnight in its own place is that place's date, not ours.
  const auckland = clockParts(Date.UTC(2026, 9, 5, 13, 0, 0), 'Pacific/Auckland')
  assert.equal(auckland?.day, 6)
  assert.equal(clockParts(noon, 'Asia/Atlantis'), null)
  assert.equal(clockParts(Number.NaN), null)
})

test('the hands creep rather than jump', () => {
  // Half past twelve puts the hour hand halfway between twelve and one, not on twelve.
  const half = handAngles({ hour: 12, minute: 30, second: 0 })
  assert.equal(half.hour, 15)
  assert.equal(half.minute, 180)
  assert.equal(half.second, 0)
  const quarter = handAngles({ hour: 3, minute: 0, second: 30 })
  assert.equal(quarter.hour, 90.25)
  assert.equal(quarter.minute, 3)
  assert.equal(quarter.second, 180)
  assert.equal(handAngles({ hour: 0, minute: 0, second: 0 }).hour, 0)
})

test('how far through the day a moment is', () => {
  assert.equal(dayFraction({ hour: 0, minute: 0, second: 0 }), 0)
  assert.equal(dayFraction({ hour: 12, minute: 0, second: 0 }), 0.5)
  assert.equal(dayFraction({ hour: 18, minute: 0, second: 0 }), 0.75)
})

test('morning, afternoon, evening and night are the bands Orbis already greets by', () => {
  assert.equal(partOfDayAt(5), 'morning')
  assert.equal(partOfDayAt(11), 'morning')
  assert.equal(partOfDayAt(12), 'afternoon')
  assert.equal(partOfDayAt(16), 'afternoon')
  assert.equal(partOfDayAt(17), 'evening')
  assert.equal(partOfDayAt(21), 'evening')
  assert.equal(partOfDayAt(22), 'night')
  assert.equal(partOfDayAt(4), 'night')
})

test('the time comes apart into the pieces a display face sets differently', () => {
  const noon = at(2026, 10, 5, 14, 7, 9)
  const twelve = timeText(noon, true, true)
  assert.match(twelve.hm, /^2.07$/)
  assert.equal(twelve.seconds, '09')
  assert.notEqual(twelve.suffix, '')
  const twentyFour = timeText(noon, false, false)
  assert.match(twentyFour.hm, /^14.07$/)
  assert.equal(twentyFour.seconds, '')
  assert.equal(twentyFour.suffix, '')
  // A place this computer does not know falls back to the time here rather than throwing in the middle of a draw.
  assert.equal(typeof timeText(noon, false, false, 'Asia/Atlantis').hm, 'string')
})

test('the difference from here, in words and in the short form', () => {
  assert.equal(offsetWords(0), 'The same time as here')
  assert.equal(offsetWords(60), '1 hour ahead')
  assert.equal(offsetWords(-180), '3 hours behind')
  assert.equal(offsetWords(330), '5 hours 30 minutes ahead')
  assert.equal(offsetWords(-45), '45 minutes behind')
  assert.equal(offsetShort(0), 'Here')
  assert.equal(offsetShort(330), '+5:30')
  assert.equal(offsetShort(-180), '−3')
})

test('a week is seven days, Monday first, with exactly one of them today', () => {
  const week = weekStrip(at(2026, 10, 8, 9, 0))
  assert.equal(week.length, 7)
  assert.equal(week.filter((day) => day.today).length, 1)
  // The 8th of October 2026 is a Thursday, so Monday is the 5th and the week runs to the 11th.
  assert.equal(week[0].day, 5)
  assert.equal(week[6].day, 11)
  assert.equal(week[3].today, true)
  assert.ok(week.every((day) => day.letter.length >= 1 && day.label.length > 1))
  // A week that crosses the end of a month still counts forwards.
  const over = weekStrip(at(2026, 10, 1, 9, 0))
  assert.deepEqual(
    over.map((day) => day.day),
    [28, 29, 30, 1, 2, 3, 4]
  )
})

// ---------------------------------------------------------------- counting down

test('a date is read strictly, and a day that does not exist is nothing at all', () => {
  assert.equal(readDay('2027-01-31'), at(2027, 1, 31))
  assert.equal(readDay(' 2027-01-31 '), at(2027, 1, 31))
  assert.equal(readDay('2027-01-31T18:30'), at(2027, 1, 31, 18, 30))
  assert.equal(readDay('2026-02-31'), null)
  assert.equal(readDay('2026-13-01'), null)
  assert.equal(readDay('2026-1-1'), null)
  assert.equal(readDay('next Tuesday'), null)
  assert.equal(readDay(''), null)
  // A leap day is a day in a leap year and not otherwise.
  assert.equal(readDay('2028-02-29'), at(2028, 2, 29))
  assert.equal(readDay('2027-02-29'), null)
})

test('how far apart two moments are', () => {
  const now = at(2026, 10, 5, 10, 0)
  const soon = span(at(2026, 10, 7, 13, 30), now)
  assert.equal(soon.past, false)
  assert.deepEqual({ days: soon.days, hours: soon.hours, minutes: soon.minutes }, { days: 2, hours: 3, minutes: 30 })
  const gone = span(at(2026, 10, 3, 10, 0), now)
  assert.equal(gone.past, true)
  assert.equal(gone.days, 2)
})

test('the big number is the largest unit that is still true', () => {
  const now = at(2026, 10, 5, 10, 0)
  assert.deepEqual(countdownFigure(span(at(2026, 10, 17, 17, 0), now)), { big: '12', unit: 'days left', sub: 'and 7 hours' })
  assert.deepEqual(countdownFigure(span(at(2026, 10, 6, 10, 0), now)), { big: '1', unit: 'day left', sub: '' })
  assert.deepEqual(countdownFigure(span(at(2026, 10, 5, 17, 12), now)), { big: '7', unit: 'hours left', sub: 'and 12 minutes' })
  assert.deepEqual(countdownFigure(span(at(2026, 10, 5, 10, 25), now)), { big: '25', unit: 'minutes left', sub: '' })
  assert.deepEqual(countdownFigure(span(at(2026, 10, 5, 10, 1), now)), { big: '1', unit: 'minute left', sub: '' })
  assert.equal(countdownFigure(span(at(2026, 10, 5, 10, 0, 30), now)).big, 'Now')
  // A date gone by counts the same way and says so.
  assert.deepEqual(countdownFigure(span(at(2026, 10, 2, 10, 0), now)), { big: '3', unit: 'days ago', sub: '' })
  assert.equal(countdownFigure(span(at(2026, 10, 5, 9, 59, 30), now)).big, 'Just now')
})

test('the ring measures from the day it was set up, and draws nothing when there is nowhere to measure from', () => {
  const start = at(2026, 1, 1)
  const end = at(2026, 1, 11)
  assert.equal(progress(start, end, at(2026, 1, 6)), 0.5)
  assert.equal(progress(start, end, at(2025, 12, 1)), 0)
  assert.equal(progress(start, end, at(2027, 1, 1)), 1)
  // A widget with no start, or one added after its own date, has no honest arc to draw.
  assert.equal(progress(0, end, at(2026, 1, 6)), null)
  assert.equal(progress(end, start, at(2026, 1, 6)), null)
})

// ---------------------------------------------------------------- the timer

const timerAt = (change: Partial<TimerSettings> = {}): TimerSettings => ({ minutes: 25, breakMinutes: 5, phase: 'focus', endsAt: 0, pausedMs: 0, finishedAt: 0, ...change })

test('the timer knows where it stands from the moment it ends, not from counting', () => {
  const now = at(2026, 10, 5, 10, 0)
  assert.deepEqual(timerStanding(timerAt(), now), { state: 'idle', leftMs: 1_500_000, totalMs: 1_500_000, phase: 'focus' })
  assert.deepEqual(timerStanding(timerAt({ endsAt: now + 600_000 }), now), { state: 'running', leftMs: 600_000, totalMs: 1_500_000, phase: 'focus' })
  assert.equal(timerStanding(timerAt({ pausedMs: 300_000 }), now).state, 'paused')
  assert.equal(timerStanding(timerAt({ pausedMs: 300_000 }), now).leftMs, 300_000)
  // The page was shut while it was running: on the way back the end time has passed, so it finished.
  assert.equal(timerStanding(timerAt({ endsAt: now - 1 }), now).state, 'done')
  assert.equal(timerStanding(timerAt({ endsAt: now - 1 }), now).leftMs, 0)
  // It is still worth saying it finished hours later, but not days later.
  assert.equal(timerStanding(timerAt({ finishedAt: now - 3_600_000 }), now).state, 'done')
  assert.equal(timerStanding(timerAt({ finishedAt: now - 86_400_000 }), now).state, 'idle')
  // A rest is as long as the rest is set to be.
  assert.equal(timerStanding(timerAt({ phase: 'rest' }), now).totalMs, 300_000)
})

test('a length left over from a longer setting never makes the ring overflow', () => {
  const now = at(2026, 10, 5, 10, 0)
  // Running 40 minutes while the setting says 25: the ring measures against what is actually running.
  const standing = timerStanding(timerAt({ endsAt: now + 2_400_000 }), now)
  assert.equal(standing.totalMs, 2_400_000)
  assert.ok(standing.leftMs <= standing.totalMs)
})

test('time left reads as a clock', () => {
  assert.equal(timerText(1_500_000), '25:00')
  assert.equal(timerText(65_000), '1:05')
  assert.equal(timerText(3_900_000), '1:05:00')
  assert.equal(timerText(0), '0:00')
  assert.equal(timerText(-5000), '0:00')
  // A second that has only just started is still that second, not the one before it.
  assert.equal(timerText(999), '0:01')
})

// ---------------------------------------------------------------- the calculator

const value = (sum: string): number => {
  const answer = calculate(sum)
  assert.equal(answer.ok, true, `"${sum}" was refused: ${answer.ok ? '' : answer.error}`)
  return answer.ok ? answer.value : Number.NaN
}

const refused = (sum: string): string => {
  const answer = calculate(sum)
  assert.equal(answer.ok, false, `"${sum}" was worked out when it should not have been`)
  return answer.ok ? '' : answer.error
}

test('the operators are taken in the right order', () => {
  assert.equal(value('2+3*4'), 14)
  assert.equal(value('2*3+4'), 10)
  assert.equal(value('10-2-3'), 5)
  assert.equal(value('100/5/2'), 10)
  assert.equal(value('1+2*3-4/2'), 5)
})

test('brackets, including ones standing in for a multiply', () => {
  assert.equal(value('(2+3)*4'), 20)
  assert.equal(value('2*(3+(4-1))'), 12)
  assert.equal(value('2(3+4)'), 14)
  assert.equal(value('(1+2)3'), 9)
  assert.equal(value('(1+2)(3+4)'), 21)
  assert.equal(refused('(2+3'), 'That is not a sum')
  assert.equal(refused('2+3)'), 'That is not a sum')
  assert.equal(refused('()'), 'That is not a sum')
})

test('a sign in front of anything', () => {
  assert.equal(value('-5'), -5)
  assert.equal(value('-5+3'), -2)
  assert.equal(value('3*-2'), -6)
  assert.equal(value('--4'), 4)
  assert.equal(value('+7'), 7)
  assert.equal(value('-(2+3)'), -5)
})

test('per cent is a hundredth of what it follows, and says so the same way every time', () => {
  assert.equal(value('15%'), 0.15)
  assert.equal(value('200*15%'), 30)
  assert.equal(value('100-50%'), 99.5)
  assert.equal(value('(40+60)%'), 1)
  assert.equal(value('50%%'), 0.005)
})

test('what the keys draw works as well as what a keyboard types', () => {
  assert.equal(value('6÷2'), 3)
  assert.equal(value('6×2'), 12)
  assert.equal(value('6−2'), 4)
  assert.equal(value('6 × 2 + 1'), 13)
})

test('nothing that is not a sum is guessed at', () => {
  assert.equal(refused(''), '')
  assert.equal(refused('   '), '')
  assert.equal(refused('alert(1)'), 'Numbers and + − × ÷ % ( ) only')
  assert.equal(refused('2**3'), 'That is not a sum')
  assert.equal(refused('1..2'), 'That is not a sum')
  assert.equal(refused('1+'), 'That is not a sum')
  assert.equal(refused('+'), 'That is not a sum')
  assert.equal(refused('3 4'), 'That is not a sum')
  assert.equal(refused('1/0'), 'Nothing can be divided by zero')
  assert.equal(refused('1/(2-2)'), 'Nothing can be divided by zero')
})

test('the noise binary floating point leaves behind is taken off, and nothing true with it', () => {
  assert.equal(value('0.1+0.2'), 0.3)
  assert.equal(value('1/3'), 0.333333333333)
  assert.equal(value('2.5*4'), 10)
  assert.equal(value('.5+.25'), 0.75)
  assert.equal(value('1000000*1000000'), 1e12)
})

test('a worked-out number can be typed on again', () => {
  for (const sum of ['0.1+0.2', '2+3*4', '-5', '1/4']) {
    const first = value(sum)
    assert.equal(value(sumValue(first)), first)
  }
  assert.equal(sumValue(Number.NaN), '')
  assert.ok(sumText(1234.5).length > 0)
  assert.equal(sumText(Number.NaN), '')
})

// ---------------------------------------------------------------- choosing one of a few

test('the same key always picks the same one', () => {
  assert.equal(pickByKey(8, 'day:2026-10-05'), pickByKey(8, 'day:2026-10-05'))
  assert.ok(pickByKey(8, 'day:2026-10-05') >= 0 && pickByKey(8, 'day:2026-10-05') < 8)
  assert.equal(pickByKey(0, 'anything'), 0)
  // Over a month it does not sit on one answer.
  const seen = new Set(Array.from({ length: 31 }, (_, day) => pickByKey(8, `day:2026-10-${String(day + 1).padStart(2, '0')}`)))
  assert.ok(seen.size >= 4, `only ${seen.size} different answers in a month`)
})

test('a day is written the one way that sorts', () => {
  assert.equal(dayKey(at(2026, 1, 5, 23, 59)), '2026-01-05')
  assert.equal(dayKey(at(2026, 12, 31, 0, 0)), '2026-12-31')
  // Morning and night on the same day are the same day.
  assert.equal(dayKey(at(2026, 10, 5, 0, 1)), dayKey(at(2026, 10, 5, 23, 58)))
})
