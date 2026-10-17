import type { FamousCheck, FamousProblem } from './famous.ts'

/**
 * Checking the famous games a game at a time.
 *
 * `checkCollection` in `famous.ts` replays every move of all fifteen games in one call. On this machine that is
 * **4.9 seconds** of arithmetic, and `checkFamousGame` on the longest game alone is 730 milliseconds. The screen ran
 * it in a timeout so the first paint was not held up, which it was not -- but a timeout does not make work
 * concurrent. The window could not answer a click for five seconds after Famous games opened, so the sort buttons
 * and the game rows looked dead: the clicks were taken, they just were not answered until long after somebody had
 * decided nothing was going to happen.
 *
 * This is the bookkeeping for doing the same work one game at a time, so the longest the window is ever busy is one
 * game. It holds no games and does no chess: the screen hands it the result of checking the next game, which keeps
 * every move of chess in the tested `famous.ts` and lets the order of the work be tested without a window.
 *
 * ## Why "how far it has got" is on screen
 *
 * A number that says "15 of 15 replayed" before any of them have been is the kind of claim this collection exists
 * not to make. A run says how many it has really replayed, so the header can say that and nothing more until the
 * last one is in.
 */

export interface CheckRun {
  /** How many games have really been replayed. Never a guess. */
  at: number
  total: number
  /** How many of the ones replayed came out right. */
  verified: number
  problems: readonly FamousProblem[]
  done: boolean
}

/** A run with nothing checked yet. `total` of nought is already finished: there is nothing to replay. */
export function startCheckRun(total: number): CheckRun {
  const count = Math.max(0, Math.floor(total))
  return { at: 0, total: count, verified: 0, problems: [], done: count === 0 }
}

/**
 * One more game's result taken in.
 *
 * A result handed in after the run has finished is ignored rather than counted twice, because a screen whose
 * timeouts overlap would otherwise report sixteen of fifteen.
 */
export function tookGame(run: CheckRun, check: FamousCheck): CheckRun {
  if (run.done) return run
  const at = run.at + 1
  return {
    at,
    total: run.total,
    verified: run.verified + (check.ok ? 1 : 0),
    problems: check.problems.length === 0 ? run.problems : [...run.problems, ...check.problems],
    done: at >= run.total
  }
}

/** The ids that appear more than once, which is the one fault no single game's check can see. */
export function duplicateIdProblems(ids: readonly string[]): FamousProblem[] {
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  const out: FamousProblem[] = []
  for (const [id, count] of counts) {
    if (count > 1) {
      out.push({ code: 'duplicate-id', message: `${id} appears ${count} times, so one copy will shadow the other.` })
    }
  }
  return out
}

/**
 * What the header says about the run, in words.
 *
 * While it is going it says how far it has got, because that is all it knows. When it is finished it says what it
 * found -- and a game that did not replay is named as that, never folded into the total.
 */
export function checkRunSays(run: CheckRun): string {
  if (run.total === 0) return 'There are no games in the collection to replay.'
  if (!run.done) return `Replaying every move: ${run.at} of ${run.total} games so far.`
  if (run.verified === run.total) return `All ${run.total} games replayed move by move against the rules.`
  const wrong = run.total - run.verified
  return `${run.verified} of ${run.total} games replayed against the rules. ${wrong} did not, and ${wrong === 1 ? 'it is' : 'they are'} listed below.`
}
