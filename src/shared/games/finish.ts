import type { GameId, ScoreRecord } from '../offlineGames.ts'
import { recordScore } from '../offlineGames.ts'
import { DEFAULT_DAY_RULES, type DayRules } from './calendar.ts'
import type { DailyChallenge } from './daily.ts'
import type { Earned, PlayRecord } from './record.ts'
import { recordRun, type ArcadeBoard } from './arcade.ts'
import type { KeptArcade } from './kept.ts'

/**
 * A finished game, written down once.
 *
 * The arcade keeps a score in two places, and they are two different facts: `library.scores` is the best score of
 * each game, judged by `beats()` so a reaction time counts the right way round, and `record.plays` is the list of
 * runs the levels, streaks, challenges and unlocks are worked out from. Both change the instant a game ends.
 *
 * So there is one function that does it, and the order inside it is the whole reason the function exists:
 *
 *   1. **the score store first.** `recordScore` decides whether this run beat your own record, because it is the
 *      thing that holds the record. `PlayRecord.newBest` says it must be "set only when the score store said this
 *      run beat your own record", and this is the only place that can honestly set it.
 *   2. **then the run.** `recordRun` asks the day's challenges whether this run completed one before writing it, so
 *      the bonus is written on the run that earned it.
 *
 * Done the other way round, a run would be written with a guess at `newBest` and the five points for beating your
 * own record would be awarded on a guess. Done in two separate calls from a screen, the two halves would disagree
 * the first time one of them was forgotten -- a best score with no run behind it, or a level standing on a run whose
 * score was never recorded.
 *
 * `now` is an argument, like everywhere else in these files, so nothing can award anything by reading the clock at a
 * convenient moment and a test can drive a day boundary.
 */

export interface FinishedRun {
  gameId: GameId
  /** What it scored, in that game's own units. */
  score: number
  /** That game's own extra records: accuracy, average reaction, streak. */
  extra?: ScoreRecord['extra']
  /** How long the run lasted, in milliseconds. Zero when the game did not measure it. */
  ms: number
  /**
   * False when the player left before a real end.
   *
   * It is still written down, because "started fourteen, finished nine" is worth knowing, but it earns nothing and
   * holds no streak up. Only the game knows which this was, so only the game can say.
   */
  finished?: boolean
  /** For the games where a run is either solved or not. Left out where that does not apply. */
  solved?: boolean
}

export interface Finished {
  kept: KeptArcade
  /** Whether this run beat your own record, as the score store measured it. */
  newBest: boolean
  /** What the record was before this run, so a screen can say what was beaten. */
  previousBest: number | undefined
  /** What the run earned, with the parts, so the number can be shown with its reason. */
  earned: Earned
  /** The challenges this run finished off. */
  completed: readonly DailyChallenge[]
  /** The board as it stands now. */
  board: ArcadeBoard
  /** What happened, in one sentence, from the arcade's own words rather than this file's. */
  says: string
}

export function finishRun(
  kept: KeptArcade,
  run: FinishedRun,
  o: { now: number; rules?: DayRules; goalId?: string; libraryGames?: number; id?: string }
): Finished {
  const rules = o.rules ?? DEFAULT_DAY_RULES
  const finished = run.finished !== false
  const previousBest = kept.library.scores[run.gameId]?.best

  /*
   * The score store, first and only for a run that finished.
   *
   * A run somebody walked away from is not a score. Recording one would raise "times played" and could set a best
   * from an abandoned board, and the whole point of the finished flag is that those two things are different.
   */
  const scored = finished
    ? recordScore(kept.library, run.gameId, run.score, run.extra, o.now)
    : { data: kept.library, newBest: false }

  const play: PlayRecord = {
    // `gameId-when` by default. Two runs of one game in the same millisecond is not something a person can do, and
    // if it ever happened `addPlay` refuses the second as a duplicate and says so rather than counting it twice.
    id: o.id ?? `${run.gameId}-${o.now.toString(36)}`,
    gameId: run.gameId,
    at: o.now,
    finished,
    score: run.score,
    difficulty: kept.library.prefs.difficulty,
    ...(run.ms > 0 ? { seconds: run.ms / 1000 } : {}),
    ...(run.solved === undefined ? {} : { solved: run.solved }),
    ...(scored.newBest && finished ? { newBest: true } : {})
  }

  const recorded = recordRun({
    record: kept.record,
    play,
    now: o.now,
    rules,
    ...(o.goalId !== undefined ? { goalId: o.goalId } : {}),
    ...(o.libraryGames !== undefined ? { libraryGames: o.libraryGames } : {})
  })

  return {
    kept: { ...kept, library: scored.data, record: recorded.added.record },
    newBest: scored.newBest && finished,
    previousBest,
    earned: recorded.added.earned,
    completed: recorded.completed,
    board: recorded.board,
    says: recorded.added.says
  }
}
