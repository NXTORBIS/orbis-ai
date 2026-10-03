import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { atText, lengthOf, MAX_MEETING_CHARS, mustStop, readSummary, summaryNote, summaryPrompt, titleFrom, transcriptText, WHAT_IT_HEARS, withPart, type Meeting } from './meeting.ts'

/**
 * Orbis hears one microphone. That makes this a good notebook and a bad minute-taker, and these guard the line
 * between the two: what was really said is kept, and what a model read into it is marked, checked, and dropped when
 * the words it quotes were never spoken.
 */

const START = new Date('2026-10-03T09:00:00').getTime()

const note = (...said: [string, number][]): Meeting => {
  let one: Meeting = { id: 'm1', title: '', startedAt: START, endedAt: null, parts: [] }
  said.forEach(([text, at], i) => {
    one = withPart(one, text, START + at, `p${i}`)
  })
  return one
}

test('what was said is kept with when it was said', () => {
  const one = note(['Right, shall we start.', 0], ['I will send the deck on Friday.', 65_000])
  assert.equal(one.parts.length, 2)
  assert.equal(one.parts[1].at, 65_000)
  assert.ok(transcriptText(one).includes('[1:05] I will send the deck on Friday.'))
})

test('nothing with no words in it is kept', () => {
  assert.equal(note(['   ', 0], ['', 1000]).parts.length, 0)
})

test('a part is never attributed to anybody, because this cannot tell voices apart', () => {
  const one = note(['I will do it.', 0])
  const keys = Object.keys(one.parts[0]).sort()
  assert.deepEqual(keys, ['at', 'id', 'text'], 'a speaker field here would be a field nothing could honestly fill')
})

test('what Orbis can hear is said in plain words, including what it cannot', () => {
  assert.ok(WHAT_IT_HEARS.includes('microphone and nothing else'))
  assert.ok(WHAT_IT_HEARS.includes('cannot tell one voice from another'))
})

test('a note names itself from the first thing said, not from a model', () => {
  assert.equal(titleFrom(note(['Budget review for the third quarter please', 0]), START), 'Budget review for the third quarter please')
  assert.ok(titleFrom(note(), START).startsWith('Note, '), 'a note with nothing in it still has a name')
})

test('a note that has run too long, or got too big, stops and says which', () => {
  assert.equal(mustStop(note(['hello', 0]), START + 1000), null)
  assert.ok(mustStop(note(['hello', 0]), START + 5 * 60 * 60 * 1000)?.includes('four hours'))
  const huge: Meeting = { ...note(), parts: [{ id: 'p', at: 0, text: 'x'.repeat(MAX_MEETING_CHARS) }] }
  assert.ok(mustStop(huge, START)?.includes('as long as one note holds'))
  assert.equal(lengthOf(huge), MAX_MEETING_CHARS)
})

test('times read as a timeline', () => {
  assert.equal(atText(0), '0:00')
  assert.equal(atText(65_000), '1:05')
  assert.equal(atText(3_600_000), '60:00')
})

// ---------------------------------------------------------------- what the model may claim

const TRANSCRIPT = note(['Right, shall we start.', 0], ['I will send the deck on Friday.', 60_000], ['We agreed to drop the second option.', 120_000])

test('what Orion is asked for forbids inventing an action, and says an empty list is a right answer', () => {
  const asked = summaryPrompt(TRANSCRIPT)
  assert.ok(asked.includes('Do not invent'), asked.slice(0, 400))
  assert.ok(asked.includes('an empty list is the right answer'))
  assert.ok(asked.includes('cannot tell voices apart'))
  assert.ok(asked.includes('I will send the deck on Friday.'), 'the transcript itself is what it reads')
})

test('an action whose quoted words are really in the transcript is kept', () => {
  const { summary, dropped } = readSummary(
    { points: ['The deck'], actions: [{ what: 'Send the deck', from: 'I will send the deck on Friday' }], decisions: [] },
    TRANSCRIPT,
    'ORION Core',
    START
  )
  assert.equal(dropped, 0)
  assert.deepEqual(summary.actions, [{ what: 'Send the deck', from: 'I will send the deck on Friday' }])
})

test('an action quoting words nobody said is dropped, because that is a task nobody agreed to', () => {
  const { summary, dropped } = readSummary(
    { actions: [{ what: 'Book the venue', from: 'I will book the venue on Monday' }] },
    TRANSCRIPT,
    'ORION Core',
    START
  )
  assert.deepEqual(summary.actions, [])
  assert.equal(dropped, 1)
})

test('an action with no quote at all is dropped, not kept on trust', () => {
  const { summary, dropped } = readSummary({ actions: [{ what: 'Do the thing' }] }, TRANSCRIPT, 'ORION Core', START)
  assert.deepEqual(summary.actions, [])
  assert.equal(dropped, 1)
})

test('what was dropped is said, because dropping it quietly hides the same problem', () => {
  const { summary, dropped } = readSummary({ actions: [{ what: 'Invented', from: 'never said this' }] }, TRANSCRIPT, 'ORION Core', START)
  const note = summaryNote(summary, dropped)
  assert.ok(note.includes('1 item was left out'), note)
  assert.ok(note.includes('not in the transcript'), note)
})

test('a summary always says it is a reading, and the transcript is what was said', () => {
  const { summary, dropped } = readSummary({ points: ['Something'] }, TRANSCRIPT, 'ORION Core', START)
  const note = summaryNote(summary, dropped)
  assert.ok(note.includes('ORION Core'), note)
  assert.ok(note.includes('what was actually said'), note)
})

test('decisions are checked exactly as actions are', () => {
  const { summary } = readSummary(
    { decisions: [{ what: 'Dropped option two', from: 'We agreed to drop the second option' }, { what: 'Made up', from: 'nobody said this' }] },
    TRANSCRIPT,
    'ORION Core',
    START
  )
  assert.equal(summary.decisions.length, 1)
})

test('an answer that is not an answer produces an empty summary rather than a crash', () => {
  const { summary } = readSummary('rubbish', TRANSCRIPT, 'ORION Core', START)
  assert.deepEqual(summary.points, [])
  assert.deepEqual(summary.actions, [])
})

test('points are capped, so a summary stays a summary', () => {
  const { summary } = readSummary({ points: Array.from({ length: 40 }, (_, i) => `point ${i}`) }, TRANSCRIPT, 'ORION Core', START)
  assert.equal(summary.points.length, 8)
})
