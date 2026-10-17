import type { TrainingArea, TrainingAttempt } from './trainingView.ts'

/**
 * What the Train group of Chess World has actually recorded, counted from the record and nothing else.
 *
 * The four trainers -- board vision, the calculation gym, the blindfold ladder, and positions drilled out against
 * the engine -- all file their goes into one list of attempts. Until now each screen counted its own part of that
 * list in its own way, and the Train screens themselves had nothing to show you but paragraphs about what the
 * trainers were for. This turns the list into numbers you can look at.
 *
 * ## Every figure here is a count of things that happened
 *
 * There is no rating, no score out of ten and no figure for anybody's ability. A go either passed or it did not,
 * and whether the answer was on the screen at the time is recorded on the go itself. So the three numbers a
 * trainer gets are: how many goes, how many passed, and how many passed with nothing on screen giving it away.
 * Those are facts. "How good are you at this" is not a thing this record can answer, so it is not offered.
 *
 * A trainer with no goes gets no numbers at all -- not a nought, which reads as a measurement, but a sentence
 * saying nothing has been recorded. That distinction is the whole reason this file exists rather than a few
 * `.filter().length` calls spread over four screens.
 */

/** The trainers, in the order they are worth doing in: see the squares, then the lines, then the whole position. */
export type TrainerId = TrainingArea

export interface TrainerFacts {
  id: TrainerId
  /** What it is called on screen. */
  title: string
  /** One short line, for a tooltip. Never a paragraph. */
  about: string
}

export const TRAINERS: readonly TrainerFacts[] = Object.freeze([
  Object.freeze({
    id: 'vision' as TrainerId,
    title: 'Board vision',
    about: 'Name a square, or find it, against a clock.'
  }),
  Object.freeze({
    id: 'calculation' as TrainerId,
    title: 'Calculation gym',
    about: 'Work the whole line out, then write it down.'
  }),
  Object.freeze({
    id: 'blindfold' as TrainerId,
    title: 'Blindfold',
    about: 'Five rungs and a whole game with the board away.'
  }),
  Object.freeze({
    id: 'drill' as TrainerId,
    title: 'Drills and endings',
    about: 'A position played out against the engine until you convert it.'
  })
])

export function trainerFacts(id: TrainerId): TrainerFacts | null {
  return TRAINERS.find((one) => one.id === id) ?? null
}

export interface TrainerStanding {
  id: TrainerId
  title: string
  /** How many goes are on record. Nought means nothing has been recorded, not that nothing was passed. */
  goes: number
  passed: number
  /** Passed with nothing on screen giving the answer away. The only count that says you knew it. */
  passedUnaided: number
  /** When the last go was filed, as the record has it, or null when there are none. */
  lastAt: number | null
  /** What the thing that marked the last go said about it. Never rewritten here. */
  lastVerdict: string | null
  /** The longest run of goes in a row that passed, counted in the order they were filed. */
  bestRun: number
  /** How it stands, in plain words. A trainer with no goes says so rather than reading as nought out of nought. */
  says: string
}

/** The goes for one trainer, oldest first, however the list arrived. */
export function goesFor(attempts: readonly TrainingAttempt[], id: TrainerId): TrainingAttempt[] {
  return attempts.filter((one) => one.area === id).sort((a, b) => a.at - b.at)
}

/** The longest run of passes in a row. Counted over the goes in the order they happened. */
export function longestRun(goes: readonly TrainingAttempt[]): number {
  let best = 0
  let run = 0
  for (const one of goes) {
    run = one.passed ? run + 1 : 0
    if (run > best) best = run
  }
  return best
}

export function trainerStanding(attempts: readonly TrainingAttempt[], id: TrainerId): TrainerStanding {
  const facts = trainerFacts(id)
  const title = facts === null ? id : facts.title
  const goes = goesFor(attempts, id)
  const passed = goes.filter((one) => one.passed).length
  const unaided = goes.filter((one) => one.passed && one.strict).length
  const last = goes.length === 0 ? null : goes[goes.length - 1]
  return {
    id,
    title,
    goes: goes.length,
    passed,
    passedUnaided: unaided,
    lastAt: last === null ? null : last.at,
    lastVerdict: last === null ? null : last.verdict,
    bestRun: longestRun(goes),
    says: standingWords(title, goes.length, passed, unaided)
  }
}

/**
 * How a trainer stands, written out.
 *
 * Kept apart from the numbers so a screen can show either, and so the one sentence that must never appear -- a
 * nought that reads as a measurement -- is written in one place.
 */
export function standingWords(title: string, goes: number, passed: number, unaided: number): string {
  if (goes === 0) return `No goes recorded at ${title.toLowerCase()} yet.`
  const tries = goes === 1 ? '1 go' : `${goes} goes`
  if (passed === 0) return `${tries}, none passed yet.`
  const how = unaided === 0
    ? ' None of them with the answer off the screen.'
    : unaided === passed
      ? ' All of them with the answer off the screen.'
      : ` ${unaided} of those with the answer off the screen.`
  return `${tries}, ${passed} passed.${how}`
}

/** Every trainer, in the order they are worth doing in, whether or not it has been used. */
export function trainBoard(attempts: readonly TrainingAttempt[]): TrainerStanding[] {
  return TRAINERS.map((one) => trainerStanding(attempts, one.id))
}

export interface TrainTotal {
  goes: number
  passed: number
  passedUnaided: number
  /** How many of the four trainers have anything on record. */
  used: number
  says: string
}

export function trainTotal(attempts: readonly TrainingAttempt[]): TrainTotal {
  const board = trainBoard(attempts)
  const goes = board.reduce((sum, one) => sum + one.goes, 0)
  const passed = board.reduce((sum, one) => sum + one.passed, 0)
  const unaided = board.reduce((sum, one) => sum + one.passedUnaided, 0)
  const used = board.filter((one) => one.goes > 0).length
  return {
    goes,
    passed,
    passedUnaided: unaided,
    used,
    says: goes === 0
      ? 'Nothing has been recorded in the Train screens yet, so there is nothing to show here.'
      : `${goes} ${goes === 1 ? 'go' : 'goes'} across ${used} of the ${TRAINERS.length} trainers, ${passed} passed, ${unaided} with the answer off the screen.`
  }
}

export interface NextUp {
  id: TrainerId
  title: string
  /** Why the record points here. Always a fact about the record, never a judgement about the person. */
  why: string
}

/**
 * What the record points at next, or nothing.
 *
 * Two rules, both about the record rather than about ability. A trainer with nothing on record is the one worth
 * opening, because there is nothing to say about it yet. Failing that, a trainer whose last three goes in a row
 * did not pass is the one the record has something to say about. Anything else and nothing is suggested: a
 * suggestion made for the sake of filling the box would be an opinion dressed as a measurement.
 */
export function nextUp(attempts: readonly TrainingAttempt[]): NextUp | null {
  const board = trainBoard(attempts)
  const untouched = board.find((one) => one.goes === 0)
  if (untouched) {
    return { id: untouched.id, title: untouched.title, why: 'Nothing recorded here yet.' }
  }
  for (const standing of board) {
    const goes = goesFor(attempts, standing.id)
    const last = goes.slice(-3)
    if (last.length === 3 && last.every((one) => !one.passed)) {
      return { id: standing.id, title: standing.title, why: 'The last three goes here did not pass.' }
    }
  }
  return null
}

/** The most recent goes across every trainer, newest first, for a list of what has really been done. */
export function recentGoes(attempts: readonly TrainingAttempt[], limit = 8): TrainingAttempt[] {
  return [...attempts].sort((a, b) => b.at - a.at).slice(0, Math.max(0, limit))
}
