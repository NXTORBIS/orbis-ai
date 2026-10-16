import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHESS_CURRICULUM } from './curriculum.ts'
import { findLesson, findTask, lessonStanding, lessonsOf, type Curriculum } from './lessons.ts'
import { newExercise, validateExercise, type Exercise } from './exercise.ts'
import { advance, type AttemptSession, type Performance, type Verdict } from './attempt.ts'
import { applyMove, legalMoves } from './rules.ts'
import {
  PROGRESS_VERSION, RECORD_CAP, academyMap, answerGaveUp, answerHint, answerPerformance, answerSubmitted,
  answerWorth, arrowGeometry, conceptStandings, creditOf, decodeProgress, emptyProgress, judgeAnswer,
  markSkipped, newAnswerAttempt, nextHintCost, nodeFor, noteReading, openedLesson, parSecondsFor,
  playOpponentReply, playedPerformance, readProgress, readingFor, recordAttempt, resumePoint, reviewToday,
  skipPlan, solutionLine, startAttempt, submitMove, syncCards, trueDestinations, truePieceCount,
  wrongAllowed, writeProgress
} from './academyPath.ts'

/**
 * What these prove.
 *
 * The parts of the Academy that are decisions rather than drawing: that a skipped lesson opens what comes after it
 * and is never counted as done, that a damaged progress file costs the rows that are damaged and nothing else, that
 * an attempt record with no record of how much help was taken is read as proving nothing, that what is due comes
 * from the scheduler Orbis already has rather than from this file, and that an answer made of squares is judged by
 * asking the rules what the squares are.
 *
 * They run against the real curriculum, not a fixture, because the real one is what somebody will be taking.
 */

const NOW = Date.UTC(2026, 9, 16, 9, 0, 0)
const DAY = 86_400_000

const solved = (exerciseId: string, worth = 1, at = NOW): Performance => ({
  exerciseId, solved: true, gaveUp: false, hintsUsed: worth === 1 ? 0 : 1, worth,
  wrongMoves: 0, illegalTries: 0, seconds: 20, at
})

const failed = (exerciseId: string, at = NOW): Performance => ({
  exerciseId, solved: false, gaveUp: false, hintsUsed: 0, worth: 1, wrongMoves: 1, illegalTries: 0, seconds: 40, at
})

/** Enough clean solves to finish a lesson, worked out from what its own assessment asks for. */
const finish = (lessonId: string, at = NOW): Performance[] => {
  const lesson = findLesson(CHESS_CURRICULUM, lessonId)
  assert.ok(lesson, `${lessonId} should exist`)
  const counted = lesson.assessment.taskIds.length > 0
    ? lesson.tasks.filter((task) => lesson.assessment.taskIds.includes(task.id))
    : lesson.tasks
  return counted.slice(0, lesson.assessment.needs).map((task) => solved(task.id, 1, at))
}

const task = (id: string): Exercise => {
  const found = findTask(CHESS_CURRICULUM, id)
  assert.ok(found, `${id} should exist`)
  return found
}

// ---------------------------------------------------------------- the content this is all built on

test('the curriculum the map is built over has the lessons and ids the rest of these tests name', () => {
  const lessons = lessonsOf(CHESS_CURRICULUM)
  assert.equal(lessons.length, 17)
  assert.equal(lessons[0].id, 'pieces-move')
  assert.equal(lessons[0].requires.length, 0)
  // Every lesson after the first needs something, which is what makes a course map worth drawing.
  assert.ok(lessons.slice(1).every((lesson) => lesson.requires.length > 0))
})

// ---------------------------------------------------------------- reading a kept file back

test('nothing saved reads as a clean start rather than an error', () => {
  const first = readProgress(null, CHESS_CURRICULUM, NOW)
  assert.equal(first.fresh, true)
  assert.deepEqual(first.repaired, [])
  assert.equal(first.progress.records.length, 0)
  assert.equal(first.progress.version, PROGRESS_VERSION)
  assert.equal(readProgress('   ', CHESS_CURRICULUM, NOW).fresh, true)
})

test('text that is not JSON is repaired rather than thrown', () => {
  const read = readProgress('{not json', CHESS_CURRICULUM, NOW)
  assert.equal(read.fresh, false)
  assert.equal(read.progress.records.length, 0)
  assert.match(read.repaired[0], /damaged/)
})

test('one unreadable attempt record costs one record and not the others', () => {
  const raw = {
    version: 1,
    curriculumId: CHESS_CURRICULUM.id,
    curriculumVersion: CHESS_CURRICULUM.version,
    records: [
      solved('pieces-knight-corner'),
      { nonsense: true },
      solved('pieces-knight-middle'),
      null,
      solved('pieces-bishop')
    ]
  }
  const read = decodeProgress(raw, CHESS_CURRICULUM, NOW)
  assert.equal(read.progress.records.length, 3)
  assert.match(read.repaired.join(' '), /2 saved attempt records could not be read/)
})

test('a record that has lost how much help was taken proves nothing, rather than proving everything', () => {
  const raw = {
    curriculumId: CHESS_CURRICULUM.id,
    records: [{ exerciseId: 'pieces-knight-corner', solved: true, at: NOW }]
  }
  const read = decodeProgress(raw, CHESS_CURRICULUM, NOW)
  assert.equal(read.progress.records.length, 1)
  assert.equal(read.progress.records[0].worth, 0)
  // And so it does not count as demonstrated, which is the whole reason the default is this way round.
  const lesson = findLesson(CHESS_CURRICULUM, 'pieces-move')
  assert.ok(lesson)
  const standing = lessonStanding(lesson, read.progress.records)
  assert.equal(standing.demonstrated.length, 0)
})

test('a field that is the wrong shape does not take the other fields with it', () => {
  const raw = {
    curriculumId: CHESS_CURRICULUM.id,
    records: [solved('pieces-knight-corner')],
    cards: 'not a list',
    reading: [{ lessonId: 'pieces-move', atBlock: 3, seconds: 90, visits: 2, firstAt: NOW, lastAt: NOW }],
    skipped: { nope: true }
  }
  const read = decodeProgress(raw, CHESS_CURRICULUM, NOW)
  assert.equal(read.progress.records.length, 1)
  assert.equal(read.progress.cards.length, 0)
  assert.equal(read.progress.reading.length, 1)
  assert.equal(read.progress.skipped.length, 0)
  assert.match(read.repaired.join(' '), /review cards were not a list/)
  assert.match(read.repaired.join(' '), /already known could not be read/)
})

test('ids the curriculum no longer has are dropped and said, not left dangling', () => {
  const raw = {
    curriculumId: CHESS_CURRICULUM.id,
    records: [solved('pieces-knight-corner'), solved('a-task-that-was-deleted')],
    cards: [{ exerciseId: 'a-task-that-was-deleted', dueAt: NOW, attempts: 2 }],
    reading: [{ lessonId: 'a-lesson-that-was-deleted' }],
    skipped: ['pieces-move', 'not-a-lesson'],
    place: { lessonId: 'gone', block: 2 }
  }
  const read = decodeProgress(raw, CHESS_CURRICULUM, NOW)
  assert.deepEqual(read.progress.records.map((one) => one.exerciseId), ['pieces-knight-corner'])
  assert.equal(read.progress.cards.length, 0)
  assert.equal(read.progress.reading.length, 0)
  assert.deepEqual(read.progress.skipped, ['pieces-move'])
  assert.equal(read.progress.place, null)
  assert.match(read.repaired.join(' '), /no longer has/)
  assert.match(read.repaired.join(' '), /not in this curriculum any more/)
})

test('progress belonging to another course is not mixed in with this one', () => {
  const raw = { curriculumId: 'some-other-course', records: [solved('pieces-knight-corner')] }
  const read = decodeProgress(raw, CHESS_CURRICULUM, NOW)
  assert.equal(read.progress.records.length, 0)
  assert.match(read.repaired[0], /different course/)
})

test('a version the records were earned against is kept and said when it has moved on', () => {
  const raw = { curriculumId: CHESS_CURRICULUM.id, curriculumVersion: CHESS_CURRICULUM.version - 1, records: [solved('pieces-bishop')] }
  const read = decodeProgress(raw, CHESS_CURRICULUM, NOW)
  assert.equal(read.progress.records.length, 1)
  assert.equal(read.progress.curriculumVersion, CHESS_CURRICULUM.version - 1)
  assert.match(read.repaired.join(' '), /version/)
})

test('a card keeps its scheduler when it is one Orbis has, and falls back when it is not', () => {
  const raw = {
    curriculumId: CHESS_CURRICULUM.id,
    cards: [
      { exerciseId: 'pieces-knight-corner', scheduler: 'leitner', state: { interval: 4, box: 2 }, dueAt: NOW, attempts: 3, solved: 2, fresh: false },
      { exerciseId: 'pieces-bishop', scheduler: 'astrology', state: { interval: 'soon' }, dueAt: NOW }
    ]
  }
  const read = decodeProgress(raw, CHESS_CURRICULUM, NOW)
  assert.equal(read.progress.cards[0].scheduler, 'leitner')
  assert.equal(read.progress.cards[0].state.box, 2)
  assert.equal(read.progress.cards[1].scheduler, 'sm2')
  assert.equal(read.progress.cards[1].state.interval, 0)
  // A card with attempts behind it but no `fresh` flag has plainly been seen.
  assert.equal(read.progress.cards[0].fresh, false)
  assert.equal(read.progress.cards[1].fresh, true)
})

test('what is written can be read back, and the cap is applied on the way out', () => {
  const many: Performance[] = []
  for (let i = 0; i < RECORD_CAP + 50; i += 1) many.push(solved('pieces-bishop', 1, NOW + i))
  const text = writeProgress({ ...emptyProgress(CHESS_CURRICULUM), records: many }, CHESS_CURRICULUM, NOW)
  const read = readProgress(text, CHESS_CURRICULUM, NOW)
  assert.equal(read.progress.records.length, RECORD_CAP)
  // The newest are the ones kept.
  assert.equal(read.progress.records[read.progress.records.length - 1].at, NOW + RECORD_CAP + 49)
  assert.equal(read.progress.savedAt, NOW)
  assert.deepEqual(read.repaired, [])
})

// ---------------------------------------------------------------- the map

test('at the start only the lesson that needs nothing is open, and the rest say what they are waiting for', () => {
  const map = academyMap(CHESS_CURRICULUM, [], [])
  assert.equal(map.total, 17)
  assert.equal(map.done, 0)
  assert.equal(map.open, 1)
  assert.equal(map.waiting, 16)
  const first = map.nodes[0]
  assert.equal(first.lesson.id, 'pieces-move')
  assert.equal(first.open, true)
  assert.equal(first.openBecause, 'nothing-needed')
  const captures = nodeFor(map, 'captures')
  assert.ok(captures)
  assert.equal(captures.state, 'waiting')
  assert.deepEqual(captures.waitingOn.map((one) => one.name), ['How the pieces move'])
  assert.match(captures.says, /How the pieces move/)
})

test('finishing a lesson opens the ones that were waiting on it, and says they were earned', () => {
  const map = academyMap(CHESS_CURRICULUM, finish('pieces-move'), [])
  assert.equal(map.done, 1)
  const first = nodeFor(map, 'pieces-move')
  assert.ok(first)
  assert.equal(first.state, 'done')
  for (const id of ['captures', 'check-and-mate', 'castling', 'promotion']) {
    const node = nodeFor(map, id)
    assert.ok(node, id)
    assert.equal(node.open, true, id)
    assert.equal(node.openBecause, 'earned', id)
  }
  // And nothing further along is opened by it.
  assert.equal(nodeFor(map, 'skewer')?.open, false)
})

test('a lesson says which lessons finishing it would open', () => {
  const map = academyMap(CHESS_CURRICULUM, [], [])
  const first = nodeFor(map, 'pieces-move')
  assert.ok(first)
  assert.ok(first.unlocks.includes('captures'))
  assert.ok(first.unlocks.includes('castling'))
  // Not a lesson that would still be waiting on something else afterwards.
  assert.ok(!first.unlocks.includes('skewer'))
  assert.ok(!first.unlocks.includes('opening-principles'))
})

test('solving with the move on screen does not finish a lesson, and the map does not pretend it did', () => {
  const practice = finish('pieces-move').map((one) => ({ ...one, worth: 0 }))
  const map = academyMap(CHESS_CURRICULUM, practice, [])
  assert.equal(map.done, 0)
  const first = nodeFor(map, 'pieces-move')
  assert.ok(first)
  assert.equal(first.state, 'open')
  assert.equal(first.tasks.demonstrated, 0)
  assert.equal(nodeFor(map, 'captures')?.open, false)
})

test('a failed attempt is a record and not a completion', () => {
  const map = academyMap(CHESS_CURRICULUM, [failed('pieces-knight-corner'), failed('pieces-bishop')], [])
  assert.equal(map.done, 0)
  assert.equal(nodeFor(map, 'pieces-move')?.tasks.demonstrated, 0)
})

// ---------------------------------------------------------------- skipping ahead

test('a skipped lesson opens what comes after it and is never counted as done', () => {
  const map = academyMap(CHESS_CURRICULUM, [], ['pieces-move'])
  assert.equal(map.done, 0)
  assert.equal(map.skipped, 1)
  const first = nodeFor(map, 'pieces-move')
  assert.ok(first)
  assert.equal(first.state, 'skipped')
  assert.match(first.says, /not counted as done/)
  const captures = nodeFor(map, 'captures')
  assert.ok(captures)
  assert.equal(captures.open, true)
  assert.equal(captures.openBecause, 'skipped-past')
  assert.match(captures.says, /already known/)
  assert.match(map.says, /marked as already known/)
})

test('credit from finishing and credit from skipping are kept apart', () => {
  const credit = creditOf(CHESS_CURRICULUM, finish('pieces-move'), ['captures'])
  assert.ok(credit.taught.has('piece-moves'))
  assert.ok(!credit.taught.has('captures'))
  assert.ok(credit.credited.has('captures'))
  // A lesson that is finished is not also "credited": it was earned.
  assert.ok(!credit.credited.has('piece-moves'))
})

test('a lesson that was finished and then also marked as skipped stays finished', () => {
  const map = academyMap(CHESS_CURRICULUM, finish('pieces-move'), ['pieces-move'])
  assert.equal(nodeFor(map, 'pieces-move')?.state, 'done')
  assert.equal(map.done, 1)
  assert.equal(map.skipped, 0)
})

test('skipping to a lesson names every unfinished lesson before it, and nothing after it', () => {
  const plan = skipPlan(CHESS_CURRICULUM, 'fork', [])
  // The ten lessons of the first four modules before Tactics begins.
  assert.equal(plan.lessonIds.length, 10)
  assert.ok(plan.lessonIds.includes('pieces-move'))
  assert.ok(plan.lessonIds.includes('opening-principles'))
  assert.ok(!plan.lessonIds.includes('fork'))
  assert.ok(!plan.lessonIds.includes('pin'))
  assert.match(plan.says, /does not finish them/)
})

test('a lesson already finished is not part of a skip plan, and is counted as such', () => {
  const plan = skipPlan(CHESS_CURRICULUM, 'captures', finish('pieces-move'))
  assert.deepEqual(plan.lessonIds, [])
  assert.equal(plan.alreadyDone, 1)
  assert.match(plan.says, /Nothing needs skipping/)
})

test('skipping to the first lesson skips nothing, and an unknown lesson plans nothing', () => {
  assert.deepEqual(skipPlan(CHESS_CURRICULUM, 'pieces-move', []).lessonIds, [])
  assert.match(skipPlan(CHESS_CURRICULUM, 'no-such-lesson', []).says, /no such lesson/)
})

test('marking skipped does not repeat an id it already has', () => {
  const once = markSkipped(emptyProgress(CHESS_CURRICULUM), ['pieces-move'])
  const twice = markSkipped(once, ['pieces-move', 'captures'])
  assert.deepEqual([...twice.skipped].sort(), ['captures', 'pieces-move'])
})

// ---------------------------------------------------------------- where to pick up

test('with nothing done, the next thing is the first lesson', () => {
  const resume = resumePoint(CHESS_CURRICULUM, emptyProgress(CHESS_CURRICULUM))
  assert.equal(resume.kind, 'next')
  assert.equal(resume.lessonId, 'pieces-move')
  assert.equal(resume.block, 0)
})

test('a lesson left part way through wins over the next unstarted one', () => {
  const progress = {
    ...emptyProgress(CHESS_CURRICULUM),
    records: finish('pieces-move'),
    place: { lessonId: 'captures', block: 3 }
  }
  const resume = resumePoint(CHESS_CURRICULUM, progress)
  assert.equal(resume.kind, 'carry-on')
  assert.equal(resume.lessonId, 'captures')
  assert.equal(resume.block, 3)
  assert.match(resume.says, /where you left off/)
})

test('a place past the end of a lesson comes back inside it', () => {
  const lesson = findLesson(CHESS_CURRICULUM, 'pieces-move')
  assert.ok(lesson)
  const resume = resumePoint(CHESS_CURRICULUM, { ...emptyProgress(CHESS_CURRICULUM), place: { lessonId: 'pieces-move', block: 9999 } })
  assert.equal(resume.block, lesson.blocks.length - 1)
})

test('a place in a lesson that is finished moves on to the next one', () => {
  const progress = { ...emptyProgress(CHESS_CURRICULUM), records: finish('pieces-move'), place: { lessonId: 'pieces-move', block: 2 } }
  const resume = resumePoint(CHESS_CURRICULUM, progress)
  assert.equal(resume.kind, 'next')
  assert.equal(resume.lessonId, 'captures')
})

test('a place in a lesson that is still locked is not where anybody is sent', () => {
  const resume = resumePoint(CHESS_CURRICULUM, { ...emptyProgress(CHESS_CURRICULUM), place: { lessonId: 'skewer', block: 1 } })
  assert.equal(resume.kind, 'next')
  assert.equal(resume.lessonId, 'pieces-move')
})

test('when every lesson is finished it says so and sends nobody anywhere', () => {
  const records = lessonsOf(CHESS_CURRICULUM).flatMap((lesson) => finish(lesson.id))
  const resume = resumePoint(CHESS_CURRICULUM, { ...emptyProgress(CHESS_CURRICULUM), records })
  assert.equal(resume.kind, 'all-done')
  assert.equal(resume.lessonId, null)
  assert.equal(academyMap(CHESS_CURRICULUM, records, []).done, 17)
})

test('everything skipped and nothing demonstrated is reported as exactly that', () => {
  const skipped = lessonsOf(CHESS_CURRICULUM).map((lesson) => lesson.id)
  const resume = resumePoint(CHESS_CURRICULUM, { ...emptyProgress(CHESS_CURRICULUM), skipped })
  assert.equal(resume.kind, 'all-done')
  assert.match(resume.says, /nothing demonstrated/)
})

// ---------------------------------------------------------------- reading, which finishes nothing

test('opening a lesson records a visit and never touches the completion', () => {
  let progress = emptyProgress(CHESS_CURRICULUM)
  progress = openedLesson(progress, 'pieces-move', NOW)
  progress = openedLesson(progress, 'pieces-move', NOW + 1000)
  const reading = readingFor(progress, 'pieces-move')
  assert.equal(reading.visits, 2)
  assert.equal(reading.firstAt, NOW)
  assert.equal(reading.lastAt, NOW + 1000)
  assert.equal(academyMap(CHESS_CURRICULUM, progress.records, progress.skipped).done, 0)
  assert.equal(progress.place?.lessonId, 'pieces-move')
})

test('how far through only ever goes up, and seconds add', () => {
  let progress = openedLesson(emptyProgress(CHESS_CURRICULUM), 'pieces-move', NOW)
  progress = noteReading(progress, 'pieces-move', { block: 5, addSeconds: 30 }, NOW)
  progress = noteReading(progress, 'pieces-move', { block: 2, addSeconds: 15 }, NOW + 1000)
  const reading = readingFor(progress, 'pieces-move')
  assert.equal(reading.atBlock, 5)
  assert.equal(reading.seconds, 45)
  // The place follows where they actually are, which is not the same as how far they have been.
  assert.equal(progress.place?.block, 2)
})

test('a lesson never opened has an empty reading record rather than no record', () => {
  const reading = readingFor(emptyProgress(CHESS_CURRICULUM), 'captures')
  assert.equal(reading.visits, 0)
  assert.equal(reading.firstAt, null)
})

// ---------------------------------------------------------------- review

test('every task gets a card, and content that has gone loses its card', () => {
  const first = syncCards(CHESS_CURRICULUM, [], NOW)
  assert.equal(first.cards.length, 34)
  assert.equal(first.added, 34)
  assert.equal(first.dropped, 0)
  const again = syncCards(CHESS_CURRICULUM, [...first.cards, { ...first.cards[0], exerciseId: 'a-task-that-was-deleted' }], NOW)
  assert.equal(again.added, 0)
  assert.equal(again.dropped, 1)
  assert.equal(again.cards.length, 34)
})

test('a card keeps its history when the content is synced again', () => {
  const made = syncCards(CHESS_CURRICULUM, [], NOW).cards
  const used = made.map((card) => (card.exerciseId === 'fork-knight' ? { ...card, attempts: 7, solved: 5, fresh: false, state: { interval: 12, ease: 2.4 } } : card))
  const again = syncCards(CHESS_CURRICULUM, used, NOW + DAY).cards
  const fork = again.find((card) => card.exerciseId === 'fork-knight')
  assert.ok(fork)
  assert.equal(fork.attempts, 7)
  assert.equal(fork.state.interval, 12)
  // Themes are read back off the content, so a retagged task is retagged on its card.
  assert.deepEqual([...fork.themes], [...task('fork-knight').tags])
})

test('nothing is due before anything has been tried, and new material is not a weakness', () => {
  const today = reviewToday(CHESS_CURRICULUM, emptyProgress(CHESS_CURRICULUM), NOW)
  assert.equal(today.review.length, 0)
  assert.equal(today.teach.length, 0)
  assert.ok(today.fresh.length > 0)
  assert.match(today.says, /new/)
  assert.ok(today.fresh.every((one) => one.card.fresh))
  assert.match(today.fresh[0].why, /Not tried yet/)
})

test('what is due says why it is due, from the card and nothing else', () => {
  let progress = emptyProgress(CHESS_CURRICULUM)
  const recorded = recordAttempt(progress, task('fork-knight'), solved('fork-knight', 1, NOW), NOW)
  progress = recorded.progress
  assert.ok(recorded.scheduled)
  const interval = recorded.scheduled.intervalDays
  assert.ok(interval >= 1)
  const later = NOW + (interval + 3) * DAY
  const today = reviewToday(CHESS_CURRICULUM, progress, later)
  const fork = today.review.find((one) => one.card.exerciseId === 'fork-knight')
  assert.ok(fork, 'the card should be due once its interval has passed')
  assert.equal(fork.overdueDays, 3)
  assert.match(fork.why, /Due 3 days ago/)
  assert.match(fork.why, /Solved 1 of 1/)
  assert.equal(fork.lesson.id, 'fork')
  assert.equal(fork.teachInstead, false)
})

test('a card that has gone wrong three times running is offered as a lesson, not a fourth guess', () => {
  let progress = emptyProgress(CHESS_CURRICULUM)
  let at = NOW
  for (let i = 0; i < 3; i += 1) {
    progress = recordAttempt(progress, task('fork-knight'), failed('fork-knight', at), at).progress
    at += 2 * DAY
  }
  const today = reviewToday(CHESS_CURRICULUM, progress, at)
  assert.equal(today.review.find((one) => one.card.exerciseId === 'fork-knight'), undefined)
  const teach = today.teach.find((one) => one.card.exerciseId === 'fork-knight')
  assert.ok(teach)
  assert.equal(teach.teachInstead, true)
  assert.match(teach.why, /3 wrong in a row/)
  assert.match(today.says, /rather than guess again/)
})

test('a schedule is shown with what the scheduler is and what it cannot do', () => {
  const today = reviewToday(CHESS_CURRICULUM, emptyProgress(CHESS_CURRICULUM), NOW)
  assert.equal(today.scheduler.label, 'SM-2')
  assert.match(today.scheduler.origin, /Wozniak/)
  assert.ok(today.scheduler.limitation.length > 20)
})

test('a theme with two attempts behind it says so rather than reading as a figure', () => {
  let progress = emptyProgress(CHESS_CURRICULUM)
  progress = recordAttempt(progress, task('fork-knight'), solved('fork-knight', 1, NOW), NOW).progress
  const today = reviewToday(CHESS_CURRICULUM, progress, NOW)
  const fork = today.themes.find((one) => one.theme === 'fork')
  assert.ok(fork)
  assert.equal(fork.attempts, 1)
  assert.match(fork.says, /too few to say much/)
  // One attempt is not a weakness, however it went.
  assert.equal(today.weakest.length, 0)
})

test('an attempt that was shown the answer is scheduled as a lapse rather than a pass', () => {
  const progress = emptyProgress(CHESS_CURRICULUM)
  const shown = recordAttempt(progress, task('fork-knight'), { ...solved('fork-knight', 0), hintsUsed: 3 }, NOW)
  assert.ok(shown.scheduled)
  assert.equal(shown.scheduled.grade.grade, 2)
  assert.match(shown.scheduled.grade.says, /not a solve/)
  const clean = recordAttempt(progress, task('fork-knight'), solved('fork-knight', 1), NOW)
  assert.ok(clean.scheduled)
  assert.ok(clean.scheduled.grade.grade >= 4)
})

test('giving up grades nought and comes back tomorrow', () => {
  const given: Performance = { exerciseId: 'fork-knight', solved: false, gaveUp: true, hintsUsed: 1, worth: 0.5, wrongMoves: 0, illegalTries: 0, seconds: 10, at: NOW }
  const recorded = recordAttempt(emptyProgress(CHESS_CURRICULUM), task('fork-knight'), given, NOW)
  assert.ok(recorded.scheduled)
  assert.equal(recorded.scheduled.grade.grade, 0)
  assert.equal(recorded.scheduled.card.dueAt, NOW + DAY)
})

test('filing an attempt keeps the record and the card apart, and respects the cap', () => {
  const many: Performance[] = []
  for (let i = 0; i < RECORD_CAP; i += 1) many.push(solved('pieces-bishop', 1, NOW - i))
  const recorded = recordAttempt({ ...emptyProgress(CHESS_CURRICULUM), records: many }, task('fork-knight'), solved('fork-knight', 1, NOW), NOW)
  assert.equal(recorded.progress.records.length, RECORD_CAP)
  assert.equal(recorded.progress.records[RECORD_CAP - 1].exerciseId, 'fork-knight')
  assert.equal(recorded.progress.cards.length, 1)
  assert.equal(recorded.progress.cards[0].exerciseId, 'fork-knight')
})

test('what counts as quick is a threshold, and a longer mate gets longer', () => {
  assert.ok(parSecondsFor(task('mate-queen-one')) < parSecondsFor(task('queen-mate-two')))
  assert.equal(parSecondsFor(task('pieces-knight-corner')), 45)
  assert.ok(parSecondsFor(task('square-catch')) > 60)
})

// ---------------------------------------------------------------- concepts

test('a concept nothing has been demonstrated for says so, and never reads as mastery', () => {
  const standings = conceptStandings(CHESS_CURRICULUM, [], [])
  const pieces = standings.find((one) => one.concept.id === 'piece-moves')
  assert.ok(pieces)
  assert.equal(pieces.taught, false)
  assert.equal(pieces.demonstrated, 0)
  assert.match(pieces.says, /Nothing demonstrated yet/)
  assert.ok(standings.every((one) => !/master/i.test(one.says)))
})

test('a concept only available because a lesson was skipped says that, and claims nothing', () => {
  const standings = conceptStandings(CHESS_CURRICULUM, [], ['pieces-move'])
  const pieces = standings.find((one) => one.concept.id === 'piece-moves')
  assert.ok(pieces)
  assert.equal(pieces.credited, true)
  assert.equal(pieces.taught, false)
  assert.match(pieces.says, /Nothing has been demonstrated/)
})

test('a concept is taught only when every lesson teaching it is finished', () => {
  const queenOnly = conceptStandings(CHESS_CURRICULUM, finish('mate-with-queen'), [])
  const queen = queenOnly.find((one) => one.concept.id === 'mate-with-queen')
  assert.ok(queen)
  assert.equal(queen.taught, true)
  assert.match(queen.says, /Taught/)
  const rook = queenOnly.find((one) => one.concept.id === 'mate-with-rook')
  assert.ok(rook)
  assert.equal(rook.taught, false)
})

test('check and checkmate are both taught by one lesson, and both are reported', () => {
  const standings = conceptStandings(CHESS_CURRICULUM, finish('check-and-mate'), [])
  assert.equal(standings.find((one) => one.concept.id === 'check')?.taught, true)
  assert.equal(standings.find((one) => one.concept.id === 'checkmate')?.taught, true)
})

// ---------------------------------------------------------------- answers that are not moves

test('the squares a piece can reach are read out of the rules, not out of the content', () => {
  const corner = task('pieces-knight-corner')
  assert.deepEqual(trueDestinations(corner.startFen, 'a1'), ['b3', 'c2'])
  // And the content agrees, which is what validateExercise already proved and this confirms from the other side.
  assert.equal(corner.answer?.kind, 'destinations')
  if (corner.answer?.kind === 'destinations') {
    assert.deepEqual([...corner.answer.squares].sort(), ['b3', 'c2'])
  }
})

test('a complete answer is accepted whatever order it was given in', () => {
  const corner = task('pieces-knight-corner')
  const verdict = judgeAnswer(corner, { squares: ['c2', 'b3'] })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.checkable, true)
  assert.deepEqual(verdict.truth, ['b3', 'c2'])
  assert.match(verdict.says, /all 2 of them/)
})

test('what an answer is missing and what it has too much of are different things to be told', () => {
  const corner = task('pieces-knight-corner')
  const short = judgeAnswer(corner, { squares: ['b3'] })
  assert.equal(short.ok, false)
  assert.deepEqual(short.missing, ['c2'])
  assert.deepEqual(short.extra, [])
  assert.match(short.says, /1 more square is legal/)
  // And it does not say which, because that would put the answer on screen before the next try.
  assert.ok(!short.says.includes('c2'))

  const over = judgeAnswer(corner, { squares: ['b3', 'c2', 'b2'] })
  assert.equal(over.ok, false)
  assert.deepEqual(over.missing, [])
  assert.deepEqual(over.extra, ['b2'])
  assert.match(over.says, /knight on a1 cannot reach b2/)
})

test('a square that is not a square is said to be no square, not an illegal move', () => {
  const verdict = judgeAnswer(task('pieces-knight-corner'), { squares: ['b3', 'c2', 'z9'] })
  assert.equal(verdict.ok, false)
  assert.match(verdict.says, /z9 is not a square/)
})

test('duplicates and capitals in an answer do not make it wrong', () => {
  const verdict = judgeAnswer(task('pieces-knight-corner'), { squares: ['B3', 'c2', 'b3', ' c2 '] })
  assert.equal(verdict.ok, true)
})

test('nothing picked yet and "there are none" are different answers', () => {
  const corner = task('pieces-knight-corner')
  const nothingYet = judgeAnswer(corner, {})
  assert.equal(nothingYet.ok, false)
  assert.match(nothingYet.says, /Nothing picked yet/)

  // An empty list is an answer, and here it is the wrong one.
  const none = judgeAnswer(corner, { squares: [] })
  assert.equal(none.ok, false)
  assert.match(none.says, /2 more squares are legal/)
})

test('a task whose answer really is "nowhere" can be answered', () => {
  // The stalemate position: Black to move, the king has no square, and that is the point of the task. An empty
  // answer had to be answerable or the task could never be solved.
  const see = task('stalemate-see')
  assert.deepEqual(trueDestinations(see.startFen, 'h8'), [])
  const verdict = judgeAnswer(see, { squares: [] })
  assert.equal(verdict.ok, true)
  assert.match(verdict.says, /there are none/)
  assert.equal(judgeAnswer(see, { squares: ['g7'] }).ok, false)
  assert.equal(judgeAnswer(see, {}).ok, false)
})

test('every answer task in the curriculum is one this can judge, and its own answer passes', () => {
  const answered = lessonsOf(CHESS_CURRICULUM).flatMap((lesson) => lesson.tasks).filter((one) => one.objective === 'answer')
  assert.equal(answered.length, 12)
  for (const one of answered) {
    assert.equal(one.answer?.kind, 'destinations', one.id)
    if (one.answer?.kind !== 'destinations') continue
    const verdict = judgeAnswer(one, { squares: one.answer.squares })
    assert.equal(verdict.ok, true, `${one.id}: ${verdict.says}`)
  }
})

test('a counted answer is counted off the board', () => {
  const counted = newExercise({
    id: 'count-test',
    kind: 'lesson-task',
    startFen: '4k3/7p/8/8/8/8/8/N3K3 w - - 0 1',
    objective: 'answer',
    prompt: 'How many pieces has Black?',
    answer: { kind: 'count', of: 'all', side: 'b', value: 2 },
    source: { kind: 'authored' }
  })
  assert.equal(truePieceCount(counted.startFen, 'b', 'all'), 2)
  assert.equal(judgeAnswer(counted, { value: 2 }).ok, true)
  const wrong = judgeAnswer(counted, { value: 3 })
  assert.equal(wrong.ok, false)
  assert.equal(wrong.truth, 2)
  assert.match(wrong.says, /Black's pieces/)
  assert.match(judgeAnswer(counted, {}).says, /No number given yet/)
})

test('an answer in words is matched against what the task accepts, and is never called checked', () => {
  const worded = newExercise({
    id: 'text-test',
    kind: 'lesson-task',
    startFen: '4k3/7p/8/8/8/8/8/N3K3 w - - 0 1',
    objective: 'answer',
    prompt: 'What is the knight doing?',
    answer: { kind: 'text', accepts: ['nothing much'] },
    source: { kind: 'authored' }
  })
  const hit = judgeAnswer(worded, { text: ' Nothing Much ' })
  assert.equal(hit.ok, true)
  assert.equal(hit.checkable, false)
  const miss = judgeAnswer(worded, { text: 'guarding b3' })
  assert.equal(miss.ok, false)
  assert.match(miss.says, /not the same as being wrong/)
})

test('a line is not an answer somebody types, and says so', () => {
  const verdict = judgeAnswer(task('castling-play'), { squares: ['g1'] })
  assert.equal(verdict.checkable, false)
  assert.match(verdict.says, /playing the line/)
})

// ---------------------------------------------------------------- one go at an answered task

test('a right answer first time is a clean solve', () => {
  const corner = task('pieces-knight-corner')
  let attempt = newAnswerAttempt(corner, NOW)
  attempt = answerSubmitted(attempt, corner, judgeAnswer(corner, { squares: ['b3', 'c2'] }), NOW + 20_000)
  assert.equal(attempt.outcome, 'solved')
  assert.equal(attempt.wrong, 0)
  const performance = answerPerformance(attempt, corner, NOW)
  assert.equal(performance.solved, true)
  assert.equal(performance.worth, 1)
  assert.equal(performance.seconds, 20)
  assert.equal(performance.illegalTries, 0)
})

test('wrong answers are forgiven exactly as many times as the task says', () => {
  const corner = task('pieces-knight-corner')
  assert.equal(wrongAllowed(corner), 2)
  const wrong = judgeAnswer(corner, { squares: ['a2'] })
  let attempt = newAnswerAttempt(corner, NOW)
  attempt = answerSubmitted(attempt, corner, wrong, NOW)
  assert.equal(attempt.outcome, null)
  attempt = answerSubmitted(attempt, corner, wrong, NOW)
  assert.equal(attempt.outcome, null)
  attempt = answerSubmitted(attempt, corner, wrong, NOW)
  assert.equal(attempt.outcome, 'failed')
  assert.equal(attempt.wrong, 3)
  // And nothing more happens to a finished attempt.
  const after = answerSubmitted(attempt, corner, judgeAnswer(corner, { squares: ['b3', 'c2'] }), NOW)
  assert.equal(after.outcome, 'failed')
  assert.equal(after.tries, 3)
})

test('a hint lowers what the attempt proves, by the same ladder a played attempt uses', () => {
  const corner = task('pieces-knight-corner')
  let attempt = newAnswerAttempt(corner, NOW)
  assert.equal(answerWorth(attempt, corner).worth, 1)
  const first = answerHint(attempt, corner)
  assert.ok(first.hint)
  assert.equal(first.hint.shows, 'theme')
  assert.equal(first.worth.worth, 0.85)
  attempt = first.attempt
  const second = answerHint(attempt, corner)
  assert.equal(second.worth.worth, 0.7)
  const third = answerHint(second.attempt, corner)
  // The last hint on this task shows the move, so a solve after it is practice.
  assert.equal(third.hint?.shows, 'move')
  assert.equal(third.worth.worth, 0)
  assert.equal(third.worth.counts, false)
  assert.match(third.worth.says, /practice rather than a solve/)
  assert.equal(answerHint(third.attempt, corner).hint, null)
})

test('what the next hint would cost is knowable before it is taken', () => {
  const corner = task('pieces-knight-corner')
  const first = nextHintCost(corner, [])
  assert.equal(first.worthAfter, 0.85)
  assert.equal(first.warns, false)
  const last = nextHintCost(corner, [1, 2])
  assert.equal(last.worthAfter, 0)
  assert.equal(last.warns, true)
  assert.equal(nextHintCost(corner, [1, 2, 3]).hint, null)
})

test('a solve with the answer on screen is recorded as practice and does not finish a lesson', () => {
  const corner = task('pieces-knight-corner')
  let attempt = newAnswerAttempt(corner, NOW)
  for (let i = 0; i < 3; i += 1) attempt = answerHint(attempt, corner).attempt
  attempt = answerSubmitted(attempt, corner, judgeAnswer(corner, { squares: ['b3', 'c2'] }), NOW + 1000)
  assert.equal(attempt.outcome, 'solved')
  const performance = answerPerformance(attempt, corner, NOW)
  assert.equal(performance.solved, true)
  assert.equal(performance.worth, 0)
  const lesson = findLesson(CHESS_CURRICULUM, 'pieces-move')
  assert.ok(lesson)
  const standing = lessonStanding(lesson, [performance])
  assert.equal(standing.demonstrated.length, 0)
  assert.match(standing.tasks[0].says, /practice rather than a solve/)
})

test('asking for the answer is recorded as giving up', () => {
  const corner = task('pieces-knight-corner')
  const attempt = answerGaveUp(newAnswerAttempt(corner, NOW), NOW + 5000)
  assert.equal(attempt.outcome, 'given-up')
  const performance = answerPerformance(attempt, corner, NOW)
  assert.equal(performance.gaveUp, true)
  assert.equal(performance.solved, false)
})

// ---------------------------------------------------------------- one go at a task that is played

/**
 * The whole played path, driven the way the screen drives it: start, submit the solver's move, play the
 * opponent's reply when the machine asks for one, clear the feedback, repeat.
 *
 * `answers` is the SAN of each of the solver's moves, in order.
 */
const playThrough = (id: string, answers: readonly string[]): { session: AttemptSession; verdicts: Verdict[] } => {
  const one = task(id)
  let session = startAttempt(one, `${id}-run`, NOW)
  const verdicts: Verdict[] = []
  let at = NOW
  for (const answer of answers) {
    at += 5000
    const step = submitMove(session, one, answer, at)
    assert.ok(step.ok, `${id}: ${answer} should have been taken (${step.refused ?? ''})`)
    verdicts.push(step.verdict)
    session = step.session
    if (session.state === 'awaiting-feedback') {
      const cleared = advance(session, { kind: 'feedback-done' }, at)
      assert.ok(cleared.ok, `${id}: the feedback should clear`)
      session = cleared.session
    }
    if (session.state === 'awaiting-opponent') {
      const replied = playOpponentReply(session, one, at)
      assert.ok(replied.reply, `${id}: the task should have a reply recorded (${replied.says})`)
      session = replied.session
      // A line can end on the opponent's move, and then the result is read and the attempt closes.
      if (session.state === 'awaiting-feedback') {
        session = advance(session, { kind: 'feedback-done' }, at).session
      }
    }
  }
  return { session, verdicts }
}

/**
 * Legal moves in the task's own position that are not one of its answers, worked out rather than guessed.
 *
 * Writing "Kd5" into a test and assuming it is legal is how a test ends up proving something about a typo.
 */
const wrongButLegal = (one: Exercise, howMany: number): string[] => {
  const answers = new Set(
    one.solution.lines
      .map((line) => applyMove(one.startFen, line.move)?.uci)
      .filter((uci): uci is string => uci !== undefined)
  )
  const out = legalMoves(one.startFen)
    .filter((move) => !answers.has(move.uci))
    // Not a move the rules themselves would call a solve, whatever the author wrote down.
    .filter((move) => !move.checkmate)
    .map((move) => move.uci)
  assert.ok(out.length >= howMany, `${one.id} should have ${howMany} legal non-answers`)
  return out.slice(0, howMany)
}

test('a mate in one is solved by playing it, and the attempt ends completed', () => {
  const line = solutionLine(task('mate-queen-one'))
  assert.equal(line.length, 1)
  const run = playThrough('mate-queen-one', line)
  assert.equal(run.session.state, 'completed')
  assert.equal(run.session.outcome, 'solved')
  assert.equal(run.verdicts[0].kind, 'solved')
  const performance = playedPerformance(run.session, task('mate-queen-one'), NOW)
  assert.ok(performance)
  assert.equal(performance.solved, true)
  assert.equal(performance.worth, 1)
  assert.equal(performance.wrongMoves, 0)
})

test('a mate in two is solved move by move, with the defence played by the task itself', () => {
  const line = solutionLine(task('queen-mate-two'))
  assert.equal(line.length, 3, `the recorded line should be solver, defence, solver: ${line.join(' ')}`)
  const run = playThrough('queen-mate-two', [line[0], line[2]])
  assert.equal(run.session.state, 'completed')
  assert.equal(run.session.outcome, 'solved')
  assert.equal(run.verdicts[0].kind, 'on-track')
  assert.equal(run.verdicts[1].kind, 'solved')
  // Three moves are on the board: two of the solver's and the defence.
  assert.equal(run.session.played.length, 3)
  assert.equal(run.session.played[1].by, 'opponent')
})

test('every mate task in the curriculum can be solved through this path', () => {
  const mates = lessonsOf(CHESS_CURRICULUM)
    .flatMap((lesson) => lesson.tasks)
    .filter((one) => one.objective === 'mate-in-n')
  assert.equal(mates.length, 9)
  for (const one of mates) {
    const line = solutionLine(one)
    assert.ok(line.length > 0, one.id)
    const solverMoves = line.filter((_, index) => index % 2 === 0)
    const run = playThrough(one.id, solverMoves)
    assert.equal(run.session.outcome, 'solved', `${one.id}: ${line.join(' ')}`)
  }
})

test('every material and draw and reconstruct task can be solved through this path', () => {
  const played = lessonsOf(CHESS_CURRICULUM)
    .flatMap((lesson) => lesson.tasks)
    .filter((one) => one.objective === 'win-material' || one.objective === 'hold-draw' || one.objective === 'reconstruct')
  assert.equal(played.length, 13)
  for (const one of played) {
    const line = solutionLine(one)
    assert.ok(line.length > 0, one.id)
    const solverMoves = line.filter((_, index) => index % 2 === 0)
    const run = playThrough(one.id, solverMoves)
    assert.equal(run.session.outcome, 'solved', `${one.id}: ${line.join(' ')}`)
  }
})

test('a line that ends on the opponent\'s move still finishes the task', () => {
  // Both sides castling: the solver plays one move and the recorded line ends with the reply. Nothing in
  // attempt.ts's events reaches `completed` on an opponent move, so without the hold-at-the-end step this task
  // would sit waiting for a move that was never coming.
  const one = task('castling-play')
  assert.deepEqual(solutionLine(one), ['O-O', 'O-O'])
  const played = submitMove(startAttempt(one, 'castle-run', NOW), one, 'O-O', NOW + 1000)
  assert.equal(played.verdict.kind, 'on-track')
  assert.equal(played.session.state, 'awaiting-opponent')

  const replied = playOpponentReply(played.session, one, NOW + 2000)
  assert.equal(replied.finished, true)
  assert.equal(replied.session.state, 'awaiting-feedback')
  assert.equal(replied.session.pending, 'solved')
  assert.match(replied.says, /end of the line/)
  // The clock stopped when the line did.
  assert.equal(replied.session.runningSince, null)

  const closed = advance(replied.session, { kind: 'feedback-done' }, NOW + 3000)
  assert.ok(closed.ok)
  assert.equal(closed.session.state, 'completed')
  assert.equal(closed.session.outcome, 'solved')
  // Two moves on the board, not three: the reply was played once.
  assert.equal(closed.session.played.length, 2)
  const performance = playedPerformance(closed.session, one, NOW)
  assert.ok(performance)
  assert.equal(performance.solved, true)
  assert.equal(performance.worth, 1)
})

test('a legal move that is not the idea is told apart from a move that cannot be played', () => {
  const one = task('mate-queen-one')
  const session = startAttempt(one, 'wrong-run', NOW)

  // Something legal, and not the answer. The board does not move and the wrong count goes up.
  const legal = submitMove(session, one, wrongButLegal(one, 1)[0], NOW + 1000)
  assert.ok(legal.ok)
  assert.equal(legal.verdict.kind, 'not-the-idea')
  assert.equal(legal.session.wrongMoves, 1)
  assert.equal(legal.session.illegalTries, 0)
  assert.equal(legal.session.fen, one.startFen, 'a move that was not the idea does not move the pieces')
  if (legal.verdict.kind === 'not-the-idea') {
    assert.match(legal.verdict.says, /legal move/)
    assert.ok(!/illegal/i.test(legal.verdict.says))
  }

  // Something that cannot be played at all. A different answer, and not counted as a wrong idea.
  const cleared = advance(legal.session, { kind: 'feedback-done' }, NOW + 1500)
  assert.ok(cleared.ok)
  const illegal = submitMove(cleared.session, one, 'Qz9', NOW + 2000)
  assert.ok(illegal.ok)
  assert.equal(illegal.verdict.kind, 'illegal')
  assert.equal(illegal.session.wrongMoves, 1)
  assert.equal(illegal.session.illegalTries, 1)
})

test('wrong moves are forgiven as many times as the task allows, and then it is failed', () => {
  const one = task('mate-queen-one')
  assert.equal(wrongAllowed(one), 2)
  let session = startAttempt(one, 'forgive-run', NOW)
  for (const wrong of wrongButLegal(one, 3)) {
    const step = submitMove(session, one, wrong, NOW)
    assert.ok(step.ok, wrong)
    session = step.session
    if (session.state === 'awaiting-feedback') session = advance(session, { kind: 'feedback-done' }, NOW).session
  }
  assert.equal(session.state, 'failed')
  assert.equal(session.outcome, 'failed')
  // It failed for running out of tries, and the history says that rather than saying somebody gave up.
  assert.match(session.why ?? '', /wrong moves|was not the idea/)
  assert.equal(session.history[session.history.length - 1].state, 'failed')
  assert.match(session.history[session.history.length - 1].why ?? '', /wrong moves|was not the idea/)
  const performance = playedPerformance(session, one, NOW)
  assert.ok(performance)
  assert.equal(performance.solved, false)
  assert.equal(performance.gaveUp, false)
})

test('asking to see the answer ends the attempt as given up, and the answer can be shown', () => {
  const one = task('fork-knight')
  const session = startAttempt(one, 'giveup-run', NOW)
  const ended = advance(session, { kind: 'give-up' }, NOW + 1000)
  assert.ok(ended.ok)
  assert.equal(ended.session.outcome, 'given-up')
  const performance = playedPerformance(ended.session, one, NOW)
  assert.ok(performance)
  assert.equal(performance.gaveUp, true)
  assert.ok(solutionLine(one).length > 0)
})

test('an attempt still going has no record yet', () => {
  const one = task('fork-knight')
  assert.equal(playedPerformance(startAttempt(one, 'open-run', NOW), one, NOW), null)
})

test('a move cannot be submitted while something is being explained', () => {
  const one = task('mate-queen-one')
  const session = startAttempt(one, 'state-run', NOW)
  const two = wrongButLegal(one, 2)
  const wrong = submitMove(session, one, two[0], NOW)
  assert.equal(wrong.session.state, 'awaiting-feedback')
  const again = submitMove(wrong.session, one, two[1], NOW)
  assert.equal(again.ok, false)
  assert.equal(again.verdict.kind, 'not-now')
  assert.equal(again.session, wrong.session, 'the refused step changes nothing')
})

test('there is no reply to play unless the machine is waiting for one', () => {
  const one = task('queen-mate-two')
  const session = startAttempt(one, 'reply-run', NOW)
  const early = playOpponentReply(session, one, NOW)
  assert.equal(early.reply, null)
  assert.match(early.says, /the attempt is active/)
})

test('a second go at a task can meet a different defence, and the same go always meets the same one', () => {
  const one = task('queen-mate-two')
  const line = solutionLine(one)
  const first = submitMove(startAttempt(one, 'pick-run', NOW), one, line[0], NOW)
  assert.equal(first.session.state, 'awaiting-opponent')
  const a = playOpponentReply(first.session, one, NOW, 0)
  const b = playOpponentReply(first.session, one, NOW, 0)
  assert.equal(a.reply?.uci, b.reply?.uci)
  // However many defences the task records, asking for a different one never returns something unplayable.
  const c = playOpponentReply(first.session, one, NOW, 1)
  assert.ok(c.reply)
})

test('a solve found outside the written line is still a solve, and says so', () => {
  // A task where the rules themselves can settle it: any mate is a mate, whether or not the author wrote it down.
  const one = task('mate-back-rank')
  const check = validateExercise(one)
  assert.ok(check.ok)
  const written = new Set(check.lines.map((line) => line.san[0]))
  const others = legalMoves(one.startFen).filter((move) => move.checkmate && !written.has(move.san))
  if (others.length === 0) return // nothing to prove on this position; the behaviour is covered by attempt.ts
  const step = submitMove(startAttempt(one, 'other-mate', NOW), one, others[0].uci, NOW)
  assert.equal(step.verdict.kind, 'solved')
  if (step.verdict.kind === 'solved') assert.equal(step.verdict.viaRecordedLine, false)
})

// ---------------------------------------------------------------- arrows

test('an arrow over the board is worked out from the squares and which way up it is', () => {
  const up = arrowGeometry('a1', 'h8', 'w')
  assert.ok(up)
  assert.equal(up.x1, 6.25)
  assert.equal(up.y1, 93.75)
  assert.equal(up.x2, 93.75)
  assert.equal(up.y2, 6.25)
  const flipped = arrowGeometry('a1', 'h8', 'b')
  assert.ok(flipped)
  assert.equal(flipped.x1, 93.75)
  assert.equal(flipped.y1, 6.25)
})

test('an arrow between squares that are not squares is not drawn at all', () => {
  assert.equal(arrowGeometry('a1', 'j9', 'w'), null)
  assert.equal(arrowGeometry('', 'h8', 'w'), null)
  assert.equal(arrowGeometry('a0', 'h8', 'w'), null)
})

// ---------------------------------------------------------------- the whole way through, once

test('a learner who finishes the first lesson properly and skips the next ends up where you would expect', () => {
  let progress = emptyProgress(CHESS_CURRICULUM)
  const corner = task('pieces-knight-corner')

  // One task, done cleanly, through the answered-task path.
  let attempt = newAnswerAttempt(corner, NOW)
  attempt = answerSubmitted(attempt, corner, judgeAnswer(corner, { squares: ['b3', 'c2'] }), NOW + 10_000)
  progress = recordAttempt(progress, corner, answerPerformance(attempt, corner, NOW), NOW).progress

  // Three more, so the lesson's assessment is satisfied.
  for (const id of ['pieces-knight-middle', 'pieces-rook-blocked', 'pieces-bishop']) {
    progress = recordAttempt(progress, task(id), solved(id, 1, NOW), NOW).progress
  }

  const map = academyMap(CHESS_CURRICULUM, progress.records, progress.skipped)
  assert.equal(nodeFor(map, 'pieces-move')?.state, 'done')
  assert.equal(nodeFor(map, 'pieces-move')?.tasks.demonstrated, 4)

  progress = markSkipped(progress, skipPlan(CHESS_CURRICULUM, 'fork', progress.records).lessonIds)
  const after = academyMap(CHESS_CURRICULUM, progress.records, progress.skipped)
  assert.equal(after.done, 1)
  assert.equal(nodeFor(after, 'fork')?.open, true)
  assert.equal(nodeFor(after, 'fork')?.openBecause, 'skipped-past')
  assert.equal(resumePoint(CHESS_CURRICULUM, progress).lessonId, 'fork')

  // And it survives being written out and read back.
  const read = readProgress(writeProgress(progress, CHESS_CURRICULUM, NOW), CHESS_CURRICULUM, NOW)
  assert.deepEqual(read.repaired, [])
  assert.equal(read.progress.records.length, 4)
  assert.equal(academyMap(CHESS_CURRICULUM, read.progress.records, read.progress.skipped).done, 1)
  assert.equal(nodeFor(academyMap(CHESS_CURRICULUM, read.progress.records, read.progress.skipped), 'fork')?.open, true)
})

test('the map is the same whichever curriculum object it is handed, as long as it is this one', () => {
  // Guards against the map quietly depending on module state rather than its argument.
  const copy: Curriculum = { ...CHESS_CURRICULUM, modules: CHESS_CURRICULUM.modules.slice(0, 1) }
  const map = academyMap(copy, [], [])
  assert.equal(map.total, 7)
  assert.equal(map.modules.length, 1)
  assert.equal(map.modules[0].minutes > 0, true)
})
