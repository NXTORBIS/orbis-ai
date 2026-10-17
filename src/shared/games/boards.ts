import type { GameId } from '../offlineGames.ts'
import { GAMES, gameInfo } from '../offlineGames.ts'
import { DEFAULT_DAY_RULES, dayKey, dayLabel, type DayRules } from './calendar.ts'
import { summaryFor, type PlayRecord } from './record.ts'
import type { KeptArcade } from './kept.ts'

/**
 * The boards: what you have done at one game, and what you have done across the arcade.
 *
 * Local, and that is the point rather than a limitation. There is no account, nothing is sent anywhere, and a high
 * score here is a fact about this profile on this computer.
 *
 * ## Nothing here is stored
 *
 * Every figure is read off the two things that are: the best scores in `library.scores` and the run list in
 * `record.plays`. There is no "most played" field and no "best day" row on disk, which is what stops any of them
 * disagreeing with what you actually did -- and what makes erasing the record erase all of it at once rather than
 * leaving a figure nobody earned.
 *
 * ## Time played is measured over the runs that are still kept, and says so
 *
 * `record.ts` keeps four hundred runs one by one and adds the older ones up into a summary, which is what stops the
 * file growing for ever. That summary carries plays, finishes, points and bests -- it does not carry seconds,
 * because a run's length is on the run. So the time figures below cover **the runs still kept one by one**, and
 * `rolledUp` on the answer says when that is less than everything. A figure labelled "time played" that silently
 * meant "time played in your last four hundred runs" would be a figure that quietly shrank as somebody played more,
 * which is the opposite of what a total is for.
 */

const IDS = new Set<string>(GAMES.map((one) => one.id))

/** The time a run took, in milliseconds. Zero where the game did not measure it. */
const msOf = (play: PlayRecord): number => (play.seconds === undefined ? 0 : Math.max(0, Math.round(play.seconds * 1000)))

// ---------------------------------------------------------------- one game

export interface GameBoardView {
  gameId: GameId
  /** The best score, as the score store judged it. Undefined when the game has never been finished. */
  best: number | undefined
  bestAt: number | undefined
  lastScore: number | undefined
  lastPlayedAt: number | undefined
  /** Times opened. */
  plays: number
  /** Times finished, which is the number a board should lead with. */
  finished: number
  /** Runs that beat your own record at the time. */
  bests: number
  /** Finished runs on hard. */
  hardFinished: number
  /** How long the kept runs of this game took altogether, in milliseconds. */
  ms: number
  /** The most recent runs, newest first. */
  runs: PlayRecord[]
  /** The average score of the finished runs in `runs`, or undefined when none of them finished. */
  averageOfRecent: number | undefined
  /** True when older runs of this game have been added up rather than kept, so `ms` and `runs` cover less than all. */
  rolledUp: boolean
}

/** One game's own board: the best, the average of what is kept, and the last runs. */
export function gameBoard(kept: KeptArcade, gameId: GameId, limit = 10): GameBoardView {
  const score = kept.library.scores[gameId]
  const summary = summaryFor(kept.record, gameId)
  const mine = kept.record.plays.filter((one) => one.gameId === gameId)
  const runs = mine.slice(0, Math.max(0, limit))
  const finishedRuns = runs.filter((one) => one.finished)
  return {
    gameId,
    best: score?.best,
    bestAt: score?.bestAt,
    lastScore: score?.lastScore,
    lastPlayedAt: score?.lastPlayedAt ?? summary?.lastAt ?? undefined,
    plays: summary?.plays ?? score?.plays ?? 0,
    finished: summary?.finished ?? 0,
    bests: summary?.bests ?? 0,
    hardFinished: summary?.hardFinished ?? 0,
    ms: mine.reduce((sum, one) => sum + msOf(one), 0),
    runs,
    averageOfRecent: finishedRuns.length ? Math.round(finishedRuns.reduce((sum, one) => sum + one.score, 0) / finishedRuns.length) : undefined,
    rolledUp: (kept.record.before?.games[gameId]?.plays ?? 0) > 0
  }
}

// ---------------------------------------------------------------- across the arcade

export interface DayRow {
  /** `YYYY-MM-DD`, the identity of a day everywhere in the arcade. */
  key: string
  /** '16 October 2026', written out rather than left to a locale so a test and a screen agree. */
  label: string
  /** Runs finished that day. */
  finished: number
  /** Runs opened that day, finished or not. */
  plays: number
  /** How long those runs took, in milliseconds, over the ones the game measured. */
  ms: number
  /** Different games played that day. */
  games: number
}

/** One row per day there is a kept run for, newest first. */
export function daysPlayed(kept: KeptArcade, rules: DayRules = DEFAULT_DAY_RULES): DayRow[] {
  const byDay = new Map<string, { plays: number; finished: number; ms: number; games: Set<GameId> }>()
  for (const play of kept.record.plays) {
    const key = dayKey(play.at, rules)
    const row = byDay.get(key) ?? { plays: 0, finished: 0, ms: 0, games: new Set<GameId>() }
    row.plays += 1
    if (play.finished) row.finished += 1
    row.ms += msOf(play)
    row.games.add(play.gameId)
    byDay.set(key, row)
  }
  // The label comes from a moment in the day rather than from the key, because `dayLabel` is the one place that
  // decides how a day is written down and it takes a moment rather than a key.
  const labels = new Map<string, string>()
  for (const play of kept.record.plays) {
    const key = dayKey(play.at, rules)
    if (!labels.has(key)) labels.set(key, dayLabel(play.at, rules))
  }
  return [...byDay.entries()]
    .map(([key, row]) => ({ key, label: labels.get(key) ?? key, plays: row.plays, finished: row.finished, ms: row.ms, games: row.games.size }))
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
}

export interface ArcadeStatsView {
  /** Games opened at least once. */
  gamesPlayed: number
  /** Games finished at least once, which is the honest "you have played 9 of 32". */
  gamesFinished: number
  gamesAvailable: number
  plays: number
  finished: number
  /** How long the kept runs took altogether, in milliseconds. */
  ms: number
  /** What you play most, by time on it. Null when nothing has been played. */
  mostPlayed: { gameId: GameId; name: string; ms: number; finished: number } | null
  /** What you finish most often. Not always the same game, which is why both are here. */
  mostFinished: { gameId: GameId; name: string; ms: number; finished: number } | null
  /** The day you played most, by time. Null when nothing has been played. */
  bestDay: DayRow | null
  /** How many different days there is a kept run for. */
  days: number
  /**
   * True when older runs have been added up rather than kept one by one, so `ms`, `bestDay` and `days` cover the
   * kept runs rather than everything. A screen showing these must say so when this is set.
   */
  rolledUp: boolean
}

/** The whole arcade at a glance, counted from the record rather than kept beside it. */
export function arcadeStats(kept: KeptArcade, rules: DayRules = DEFAULT_DAY_RULES): ArcadeStatsView {
  const rows = (Object.keys(kept.library.scores) as GameId[])
    .concat(kept.record.plays.map((one) => one.gameId))
    .concat(Object.keys(kept.record.before?.games ?? {}) as GameId[])
    .filter((id) => IDS.has(id))
  const seen = [...new Set(rows)]
  const boards = seen.map((gameId) => {
    const board = gameBoard(kept, gameId, 0)
    return { gameId, name: gameInfo(gameId).name, ms: board.ms, finished: board.finished, plays: board.plays }
  })
  // Ties broken by name, so the same record always answers with the same game rather than whichever the key order
  // happened to give -- a figure that changes when nothing changed is a figure nobody trusts.
  const byTime = [...boards].sort((a, b) => b.ms - a.ms || b.finished - a.finished || (a.name < b.name ? -1 : 1))
  const byFinished = [...boards].sort((a, b) => b.finished - a.finished || b.ms - a.ms || (a.name < b.name ? -1 : 1))
  const days = daysPlayed(kept, rules)
  const bestDay = [...days].sort((a, b) => b.ms - a.ms || b.finished - a.finished || (a.key > b.key ? -1 : 1))[0] ?? null
  const anything = boards.some((one) => one.plays > 0 || one.finished > 0)
  return {
    gamesPlayed: boards.filter((one) => one.plays > 0).length,
    gamesFinished: boards.filter((one) => one.finished > 0).length,
    gamesAvailable: GAMES.length,
    plays: boards.reduce((sum, one) => sum + one.plays, 0),
    finished: boards.reduce((sum, one) => sum + one.finished, 0),
    ms: boards.reduce((sum, one) => sum + one.ms, 0),
    mostPlayed: anything && byTime[0] && byTime[0].ms > 0 ? byTime[0] : null,
    mostFinished: anything && byFinished[0] && byFinished[0].finished > 0 ? byFinished[0] : null,
    bestDay,
    days: days.length,
    rolledUp: kept.record.before !== null
  }
}

/** The games with the most time on them, for the board. Only games with measured time. */
export function topByTime(kept: KeptArcade, limit = 5): { gameId: GameId; name: string; ms: number; finished: number }[] {
  const seen = [...new Set(kept.record.plays.map((one) => one.gameId))].filter((id) => IDS.has(id))
  return seen
    .map((gameId) => {
      const board = gameBoard(kept, gameId, 0)
      return { gameId, name: gameInfo(gameId).name, ms: board.ms, finished: board.finished }
    })
    .filter((one) => one.ms > 0)
    .sort((a, b) => b.ms - a.ms || (a.name < b.name ? -1 : 1))
    .slice(0, Math.max(0, limit))
}
