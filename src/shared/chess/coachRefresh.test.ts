import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  NEVER_READ, failedReading, finishedReading, howLongAgo, reading, refreshButtonWords, refreshWords, stale,
  startedReading
} from './coachRefresh.ts'

test('before anything is asked for, the words say the record has not been read', () => {
  assert.equal(NEVER_READ.phase, 'never')
  assert.equal(reading(NEVER_READ), false)
  assert.match(refreshWords(NEVER_READ, 1_000), /has not been read/)
  assert.equal(refreshButtonWords(NEVER_READ, true), 'Bring up to date')
})

test('a read that is running says so, and the button says it is working', () => {
  const going = startedReading(NEVER_READ, 1_000)
  assert.equal(going.phase, 'reading')
  assert.equal(reading(going), true)
  assert.equal(going.startedAt, 1_000)
  assert.match(refreshWords(going, 1_500), /Reading your games/)
  assert.equal(refreshButtonWords(going, true), 'Reading…')
})

/**
 * The fault this module exists for.
 *
 * The coach sat on "Still reading what you have done." for ever, because the read could end without anything ever
 * turning the reading state off. So both ways out of `reading` are checked: a read that finished and a read that
 * failed both leave a state that is no longer reading, and both record the moment.
 */
test('every end of a read leaves it not reading, and records when it ended', () => {
  const going = startedReading(NEVER_READ, 1_000)

  const done = finishedReading(going, 4_000)
  assert.equal(reading(done), false)
  assert.equal(done.phase, 'read')
  assert.equal(done.finishedAt, 4_000)
  assert.equal(done.startedAt, null)
  assert.equal(done.problem, null)
  assert.equal(done.reads, 1)

  const broke = failedReading(going, 5_000, 'Your games could not be read.')
  assert.equal(reading(broke), false)
  assert.equal(broke.phase, 'failed')
  assert.equal(broke.finishedAt, 5_000)
  assert.equal(broke.problem, 'Your games could not be read.')
})

test('a failure with no reason still says something, because a silent failure reads as success', () => {
  const broke = failedReading(startedReading(NEVER_READ, 0), 10, '')
  assert.match(broke.problem ?? '', /could not be read/)
  assert.match(refreshWords(broke, 10), /did not finish/)
  assert.equal(refreshButtonWords(broke, true), 'Try again')
})

test('asking again clears the last failure, because it is being tried again', () => {
  const broke = failedReading(NEVER_READ, 10, 'gone wrong')
  const again = startedReading(broke, 20)
  assert.equal(again.problem, null)
  // The last finish is kept: it is still true that the last attempt was at 10.
  assert.equal(again.finishedAt, 10)
})

test('when it last finished is said the way somebody would say it', () => {
  assert.equal(howLongAgo(0), 'just now')
  assert.equal(howLongAgo(30_000), 'just now')
  assert.equal(howLongAgo(60_000), 'a minute ago')
  assert.equal(howLongAgo(4 * 60_000), '4 minutes ago')
  assert.equal(howLongAgo(3_600_000), 'an hour ago')
  assert.equal(howLongAgo(5 * 3_600_000), '5 hours ago')
  assert.equal(howLongAgo(86_400_000), 'yesterday')
  assert.equal(howLongAgo(3 * 86_400_000), '3 days ago')
  // A clock that moved backwards is not reported as a read in the future.
  assert.equal(howLongAgo(-5_000), 'just now')
})

test('a finished read says when it finished', () => {
  const done = finishedReading(startedReading(NEVER_READ, 0), 1_000_000)
  assert.equal(refreshWords(done, 1_000_000 + 4 * 60_000), 'Last read 4 minutes ago.')
})

test('a screen handed a fixed record is told the button only moves the clock', () => {
  assert.equal(refreshButtonWords(NEVER_READ, false), 'Move the clock on')
  assert.equal(refreshButtonWords(startedReading(NEVER_READ, 0), false), 'Move the clock on')
})

test('nothing is stale while it is being read, and nothing is stale before the first read', () => {
  assert.equal(stale(NEVER_READ, 10_000_000), false)
  assert.equal(stale(startedReading(NEVER_READ, 0), 10_000_000), false)
  const done = finishedReading(NEVER_READ, 1_000)
  assert.equal(stale(done, 1_000 + 60_000), false)
  assert.equal(stale(done, 1_000 + 600_000), true)
  assert.equal(stale(done, 1_000 + 2_000, 1_000), true)
})
