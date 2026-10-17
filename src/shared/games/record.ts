import type { GameId } from '../offlineGames.ts'
import { GAMES, beats } from '../offlineGames.ts'
import { DAY, DEFAULT_DAY_RULES, dayKey, dayStart, type DayRules } from './calendar.ts'

/**
 * What the arcade writes down when you finish a run, and what a run earns.
 *
 * ## One list of runs, and nothing else
 *
 * Levels, mastery, unlocks, the day's challenge and the streak are all worked out from this list every time they are
 * shown. There is no level counter and no unlock flag on disk, which is why none of them can drift from what you
 * actually did, and why erasing the list erases all of it at once rather than leaving a rank nobody earned.
 *
 * ## The rules a run has to pass
 *
 * The obvious way to get a streak or a rank cheaply is to write down runs that did not happen, or to write yesterday's
 * run down twice. Chess World settled these rules first (`src/shared/chess/challenges.ts`, `STREAK_RULES`) and the
 * arcade uses the same reasoning:
 *
 *   - a run counts only when it **finished** -- reached a real end and reported a score. Opening a game and walking
 *     away is recorded, because "started 14, finished 9" is worth knowing, but it earns nothing and holds no streak up;
 *   - two records with one id are one run, and the earlier time is the one kept;
 *   - a run counts on the day it was played, from its own time, never the day it is looked at;
 *   - a run timed later than now is ignored outright. A day that has not happened cannot be credited;
 *   - a run written down on a later day than the one it claims still counts in your totals, but it cannot credit that
 *     day -- so a streak can never be repaired after the fact.
 *
 * ## What a run earns is decided once, and written on the run
 *
 * `earnedFor` is the whole rule and `POINT_RULES` is that rule in words, shown on the screen beside the number. The
 * points a run earned are stored **on the run**, at the moment it was recorded, because two of the bonuses depend on
 * what had happened before it -- and a total that changed every time an old run dropped out of the list would be a
 * figure nobody could trust.
 *
 * Nothing is earned from the size of a score. A snake of 60 and a 2048 board of 20,480 are not comparable numbers, so
 * they are never added together.
 */

export type Difficulty = 'easy' | 'normal' | 'hard'

export interface PlayRecord {
  /** This run's own id. Two records with one id are one run. */
  id: string
  gameId: GameId
  /** When it was played. */
  at: number
  /** When it was written down, when that was not the moment it happened. */
  recordedAt?: number
  /** True when the game reached a real end and reported a score. */
  finished: boolean
  score: number
  difficulty: Difficulty
  /** How long it lasted, only when the game measured it. */
  seconds?: number
  /** For the games where a run is either solved or not. Left out where that does not apply. */
  solved?: boolean
  /** Set only when the score store said this run beat your own record. */
  newBest?: boolean
  /** The day's challenge this run was an attempt at, by its id. */
  challenge?: string
  /** Set when this run was the one that completed that challenge, as measured when it was recorded. */
  challengeDone?: boolean
  /** What this run earned, decided when it was recorded. */
  points?: number
}

export interface GameSummary {
  plays: number
  finished: number
  points: number
  /** Runs that beat your own record at the time. */
  bests: number
  /** Finished runs on hard. */
  hardFinished: number
  /** The best score, judged the way that game judges scores (a reaction time wants to be low). */
  best: number | null
  lastAt: number | null
}

/** Runs too old to keep one by one, added up so no total ever falls when they are dropped. */
export interface RolledUp {
  plays: number
  finished: number
  points: number
  /** Runs that completed a day's challenge. */
  challenges: number
  /**
   * The longest run of days with a finished run in it, as it stood when these runs were added up.
   *
   * Written down here because it is the one figure that could otherwise go **backwards**: the days a rolled-up run
   * belonged to are no longer known one by one, so a run of days counted from the list alone would shrink when old
   * runs were added up -- and something you had earned would close again. It was measured while the records were
   * still there, so it is kept.
   */
  longestRun?: number
  /** The newest moment covered. Days up to here are no longer known one by one. */
  upTo: number
  games: Partial<Record<GameId, GameSummary>>
}

export interface ArcadeRecord {
  schemaVersion: 1
  /**
   * This machine's own salt, made once by the window.
   *
   * It is what makes the day's challenge the same for this machine on this day and different on another, with nothing
   * sent anywhere to arrange it.
   */
  installId: string
  /** Newest first. */
  plays: PlayRecord[]
  before: RolledUp | null
}

/** Runs kept one by one. Older ones are added up instead. */
export const KEEP_PLAYS = 400

export const emptyRecord = (installId = ''): ArcadeRecord => ({ schemaVersion: 1, installId, plays: [], before: null })

// ---------------------------------------------------------------- what a run earns

export const POINTS = Object.freeze({ finished: 10, normal: 3, hard: 6, newBest: 5, firstTime: 20, challenge: 15 })

/** The whole earning rule in words. Shown wherever points are shown, because a number whose meaning is private is not a number. */
export const POINT_RULES: readonly string[] = Object.freeze([
  `A run you finished earns ${POINTS.finished} points. A run you walked away from earns none: the arcade counts what you finished, not what you opened.`,
  `Normal adds ${POINTS.normal} and hard adds ${POINTS.hard}. Easy adds nothing, and takes nothing away.`,
  `Beating your own best at that game adds ${POINTS.newBest} -- only when the score was really compared, never when it was guessed at.`,
  `The first run you ever finish of a game adds ${POINTS.firstTime}, once per game.`,
  `The run that completes the day's challenge adds ${POINTS.challenge}. A run that finishes off both of a day's challenges earns it once, not twice.`,
  'Nothing is earned from the size of the score. Scores in different games are not comparable, so they are never added together.'
])

export interface Earned {
  points: number
  parts: { label: string; points: number }[]
  says: string
}

/**
 * What one run earned.
 *
 * The two facts it cannot see for itself are handed in: whether this was the first finish of that game, and whether
 * this run completed the day's challenge. Both are measured by the caller from the record it already has.
 */
export function earnedFor(play: PlayRecord, o: { firstFinishOfGame: boolean; challengeDone: boolean }): Earned {
  const parts: { label: string; points: number }[] = []
  if (play.finished) {
    parts.push({ label: 'Finished a run', points: POINTS.finished })
    if (play.difficulty === 'normal') parts.push({ label: 'On normal', points: POINTS.normal })
    if (play.difficulty === 'hard') parts.push({ label: 'On hard', points: POINTS.hard })
    if (play.newBest === true) parts.push({ label: 'Beat your own best', points: POINTS.newBest })
    if (o.firstFinishOfGame) parts.push({ label: 'First time you finished this one', points: POINTS.firstTime })
    if (o.challengeDone) parts.push({ label: "The day's challenge", points: POINTS.challenge })
  }
  const points = parts.reduce((sum, one) => sum + one.points, 0)
  return {
    points,
    parts,
    says: play.finished ? `${points} points: ${parts.map((one) => `${one.label} ${one.points}`).join(', ')}.` : 'Nothing earned: the run was not finished.'
  }
}

// ---------------------------------------------------------------- reading what was stored

const IDS = new Set<string>(GAMES.map((g) => g.id))
const isId = (v: unknown): v is GameId => typeof v === 'string' && IDS.has(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const difficultyOf = (v: unknown): Difficulty => (v === 'easy' || v === 'hard' ? v : 'normal')

function readPlay(raw: unknown): PlayRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<PlayRecord>
  if (!isId(r.gameId) || !finite(r.at) || typeof r.id !== 'string' || !r.id) return null
  return {
    id: r.id,
    gameId: r.gameId,
    at: r.at,
    ...(finite(r.recordedAt) ? { recordedAt: r.recordedAt } : {}),
    finished: r.finished === true,
    score: finite(r.score) ? r.score : 0,
    difficulty: difficultyOf(r.difficulty),
    ...(finite(r.seconds) ? { seconds: Math.max(0, r.seconds) } : {}),
    ...(typeof r.solved === 'boolean' ? { solved: r.solved } : {}),
    ...(r.newBest === true ? { newBest: true } : {}),
    ...(typeof r.challenge === 'string' && r.challenge ? { challenge: r.challenge } : {}),
    ...(r.challengeDone === true ? { challengeDone: true } : {}),
    ...(finite(r.points) ? { points: Math.max(0, Math.round(r.points)) } : {})
  }
}

function readSummary(raw: unknown): GameSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<GameSummary>
  return {
    plays: finite(r.plays) ? Math.max(0, Math.round(r.plays)) : 0,
    finished: finite(r.finished) ? Math.max(0, Math.round(r.finished)) : 0,
    points: finite(r.points) ? Math.max(0, Math.round(r.points)) : 0,
    bests: finite(r.bests) ? Math.max(0, Math.round(r.bests)) : 0,
    hardFinished: finite(r.hardFinished) ? Math.max(0, Math.round(r.hardFinished)) : 0,
    best: finite(r.best) ? r.best : null,
    lastAt: finite(r.lastAt) ? r.lastAt : null
  }
}

export interface ReadResult {
  record: ArcadeRecord
  /**
   * True when there was something stored and it could not be read as an arcade record.
   *
   * The caller must not save over it. Unreadable is not missing: a record that merely cannot be parsed is somebody's
   * whole history, and writing a fresh one over it is the one mistake that cannot be undone.
   */
  unreadable: boolean
  /** Runs that were in the list and could not be read. */
  dropped: number
  says: string
}

/** Reads a stored arcade record, keeping everything readable and saying plainly when something was not. */
export function readArcade(raw: unknown, o: { installId?: string } = {}): ReadResult {
  if (raw === null || raw === undefined) {
    return { record: emptyRecord(o.installId ?? ''), unreadable: false, dropped: 0, says: 'Nothing has been played yet.' }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { record: emptyRecord(o.installId ?? ''), unreadable: true, dropped: 0, says: 'There is something stored here that is not an arcade record. It has been left alone.' }
  }
  const r = raw as Partial<ArcadeRecord>
  if (r.plays !== undefined && !Array.isArray(r.plays)) {
    return { record: emptyRecord(o.installId ?? ''), unreadable: true, dropped: 0, says: "The stored list of runs isn't a list. It has been left alone rather than written over." }
  }
  const plays: PlayRecord[] = []
  let dropped = 0
  for (const one of r.plays ?? []) {
    const play = readPlay(one)
    if (play) plays.push(play)
    else dropped += 1
  }
  plays.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
  let before: RolledUp | null = null
  if (r.before && typeof r.before === 'object') {
    const b = r.before as Partial<RolledUp>
    const games: Partial<Record<GameId, GameSummary>> = {}
    for (const [id, summary] of Object.entries(b.games && typeof b.games === 'object' ? b.games : {})) {
      const read = readSummary(summary)
      if (isId(id) && read) games[id] = read
    }
    before = {
      plays: finite(b.plays) ? Math.max(0, Math.round(b.plays)) : 0,
      finished: finite(b.finished) ? Math.max(0, Math.round(b.finished)) : 0,
      points: finite(b.points) ? Math.max(0, Math.round(b.points)) : 0,
      challenges: finite(b.challenges) ? Math.max(0, Math.round(b.challenges)) : 0,
      ...(finite(b.longestRun) ? { longestRun: Math.max(0, Math.round(b.longestRun)) } : {}),
      upTo: finite(b.upTo) ? b.upTo : 0,
      games
    }
  }
  return {
    record: { schemaVersion: 1, installId: typeof r.installId === 'string' && r.installId ? r.installId : (o.installId ?? ''), plays, before },
    unreadable: false,
    dropped,
    says: dropped > 0 ? `${dropped} ${dropped === 1 ? 'run was' : 'runs were'} stored in a shape this version cannot read, and ${dropped === 1 ? 'it was' : 'they were'} left out of the figures.` : 'Read.'
  }
}

// ---------------------------------------------------------------- adding a run

/** A run written down on a later day than the one it claims. It counts in totals; it cannot credit that day. */
export const isLate = (play: PlayRecord, rules: DayRules = DEFAULT_DAY_RULES): boolean =>
  play.recordedAt !== undefined && dayKey(play.recordedAt, rules) !== dayKey(play.at, rules)

/** Runs that may credit a day: finished, not timed in the future, not written down afterwards. */
export function creditable(plays: readonly PlayRecord[], now: number, rules: DayRules = DEFAULT_DAY_RULES): PlayRecord[] {
  return plays.filter((one) => one.finished && one.at <= now && !isLate(one, rules))
}

export type Refusal = 'future' | 'duplicate'

export interface Added {
  record: ArcadeRecord
  /** The run as it was written down, or null when it was refused. */
  play: PlayRecord | null
  earned: Earned
  /** Written down on a later day than it claims, so it cannot credit that day. */
  late: boolean
  refused: Refusal | null
  says: string
}

/**
 * Writes one run down.
 *
 * `now` is an argument, like everywhere else here, so a test can drive a day boundary and a clock set backwards -- and
 * so nothing in the arcade can award anything by reading the clock at a convenient moment.
 */
export function addPlay(record: ArcadeRecord, play: PlayRecord, now: number, rules: DayRules = DEFAULT_DAY_RULES, o: { keep?: number } = {}): Added {
  const nothing = earnedFor({ ...play, finished: false }, { firstFinishOfGame: false, challengeDone: false })
  if (play.at > now) {
    return { record, play: null, earned: nothing, late: false, refused: 'future', says: 'That run is timed later than now, so it has not been counted. A day that has not happened cannot be credited.' }
  }
  const already = record.plays.find((one) => one.id === play.id)
  if (already) {
    return { record, play: already, earned: nothing, late: isLate(already, rules), refused: 'duplicate', says: 'That run is already written down. Two records with one id are one run, and the earlier time is the one kept.' }
  }
  // A run handed in with no record time is being written down now, which is what makes an old run a late record.
  const recordedAt = play.recordedAt ?? now
  const late = isLate({ ...play, recordedAt }, rules)
  const seen = summaryFor(record, play.gameId)
  const earned = earnedFor(play, { firstFinishOfGame: play.finished && (seen?.finished ?? 0) === 0, challengeDone: play.challengeDone === true && !late })
  const written: PlayRecord = { ...play, recordedAt, points: earned.points }
  const plays = [written, ...record.plays].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
  const next = trim({ ...record, plays }, o.keep, rules)
  return {
    record: next,
    play: written,
    earned,
    late,
    refused: null,
    says: late
      ? `${earned.says} It was written down after the day it claims, so it counts in your totals and cannot credit that day.`
      : earned.says
  }
}

/**
 * The longest run of days with a finished run in it, over the runs handed in.
 *
 * Only runs that may credit a day are counted, by the same rules as everywhere else: finished, and not written down
 * after the day they claim. Runs timed in the future never reach a record -- `addPlay` refuses them -- so there is
 * nothing here to filter them out again.
 */
export function longestRunOfDays(plays: readonly PlayRecord[], rules: DayRules = DEFAULT_DAY_RULES): number {
  const days = [...new Set(plays.filter((one) => one.finished && !isLate(one, rules)).map((one) => dayStart(one.at, rules)))].sort((a, b) => a - b)
  let longest = 0
  let run = 0
  for (const [at, day] of days.entries()) {
    run = at > 0 && day - days[at - 1] === DAY ? run + 1 : 1
    longest = Math.max(longest, run)
  }
  return longest
}

/** Rolls the runs past the keeping limit into one summary, so dropping them changes no total. */
export function trim(record: ArcadeRecord, keep = KEEP_PLAYS, rules: DayRules = DEFAULT_DAY_RULES): ArcadeRecord {
  if (record.plays.length <= keep) return record
  const kept = record.plays.slice(0, keep)
  const old = record.plays.slice(keep)
  const before: RolledUp = {
    plays: record.before?.plays ?? 0,
    finished: record.before?.finished ?? 0,
    points: record.before?.points ?? 0,
    challenges: record.before?.challenges ?? 0,
    // Measured over every run still here, because after this the days the dropped runs belonged to are gone.
    longestRun: Math.max(record.before?.longestRun ?? 0, longestRunOfDays(record.plays, rules)),
    upTo: Math.max(record.before?.upTo ?? 0, ...old.map((one) => one.at)),
    games: { ...record.before?.games }
  }
  for (const one of old) {
    before.plays += 1
    before.points += one.points ?? 0
    if (one.finished) before.finished += 1
    if (one.challengeDone === true) before.challenges += 1
    // Copied, never written through: the map was shallow-copied from the record this one is replacing, so adding to
    // a summary in place would change the figures of a record somebody may still be looking at.
    const prior = before.games[one.gameId]
    const summary = prior ? { ...prior } : blank()
    summary.plays += 1
    summary.points += one.points ?? 0
    if (one.finished) summary.finished += 1
    if (one.newBest === true) summary.bests += 1
    if (one.finished && one.difficulty === 'hard') summary.hardFinished += 1
    if (one.finished && beats(one.gameId, one.score, summary.best ?? undefined)) summary.best = one.score
    summary.lastAt = Math.max(summary.lastAt ?? 0, one.at)
    before.games[one.gameId] = summary
  }
  return { ...record, plays: kept, before }
}

// ---------------------------------------------------------------- what the record adds up to

const blank = (): GameSummary => ({ plays: 0, finished: 0, points: 0, bests: 0, hardFinished: 0, best: null, lastAt: null })

/**
 * Everything the record says about one game, or null when it has never been played.
 *
 * Null rather than a row of noughts, on purpose. "Never played" and "played and scored nothing" are different facts,
 * and a screen that shows the first as the second is inventing a measurement.
 */
export function summaryFor(record: ArcadeRecord, gameId: GameId): GameSummary | null {
  const rolled = record.before?.games[gameId]
  const mine = record.plays.filter((one) => one.gameId === gameId)
  if (!rolled && mine.length === 0) return null
  const out: GameSummary = rolled ? { ...rolled } : blank()
  for (const one of mine) {
    out.plays += 1
    out.points += one.points ?? 0
    if (one.finished) out.finished += 1
    if (one.newBest === true) out.bests += 1
    if (one.finished && one.difficulty === 'hard') out.hardFinished += 1
    if (one.finished && beats(gameId, one.score, out.best ?? undefined)) out.best = one.score
    out.lastAt = Math.max(out.lastAt ?? 0, one.at)
  }
  return out
}

export interface Totals {
  plays: number
  finished: number
  points: number
  /** Runs that completed a day's challenge. */
  challenges: number
  /** Games opened at least once. */
  gamesPlayed: number
  /** Games with at least one finished run. */
  gamesFinished: number
  /** Finished runs on hard. */
  hardFinished: number
  /** Runs that beat your own record at the time. */
  bests: number
  /** The oldest run still known one by one, or null when there are none. */
  keptFrom: number | null
  /** True when older runs have been added up rather than kept. */
  rolledUp: boolean
}

export function totalsOf(record: ArcadeRecord): Totals {
  const out: Totals = {
    plays: record.before?.plays ?? 0,
    finished: record.before?.finished ?? 0,
    points: record.before?.points ?? 0,
    challenges: record.before?.challenges ?? 0,
    gamesPlayed: 0,
    gamesFinished: 0,
    hardFinished: 0,
    bests: 0,
    keptFrom: record.plays.length ? record.plays[record.plays.length - 1].at : null,
    rolledUp: record.before !== null
  }
  const played = new Set<GameId>(Object.keys(record.before?.games ?? {}) as GameId[])
  const finishedIn = new Set<GameId>()
  for (const [id, summary] of Object.entries(record.before?.games ?? {}) as [GameId, GameSummary][]) {
    out.hardFinished += summary.hardFinished
    out.bests += summary.bests
    if (summary.finished > 0) finishedIn.add(id)
  }
  for (const one of record.plays) {
    out.plays += 1
    out.points += one.points ?? 0
    played.add(one.gameId)
    if (one.finished) {
      out.finished += 1
      finishedIn.add(one.gameId)
      if (one.difficulty === 'hard') out.hardFinished += 1
    }
    if (one.newBest === true) out.bests += 1
    if (one.challengeDone === true) out.challenges += 1
  }
  out.gamesPlayed = played.size
  out.gamesFinished = finishedIn.size
  return out
}
