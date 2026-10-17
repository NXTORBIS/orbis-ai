import type { GameId, OfflineGamesData, OfflineGamesPrefs } from '../offlineGames.ts'
import { DEFAULT_PREFS, GAMES, gameInfo, normalizeData } from '../offlineGames.ts'
import { emptyRecord, readArcade, type ArcadeRecord } from './record.ts'

/**
 * What the arcade keeps, and where it keeps it.
 *
 * Everything -- high scores, favourites, what you played last, the preferences, the games left part way through and
 * every run you have finished -- used to be one `localStorage` key. That has three consequences nobody chose: a
 * second Orbis window keeps its own high scores, two people sharing a computer share one table, and a profile taken
 * to another machine arrives with nothing played. It is one file in the profile now
 * (`src/main/games/arcadeStore.ts`), and this file is the shape that goes in it.
 *
 * ## Two parts, one file
 *
 * `library` is what the shell has always worked with: the preferences, the favourites, the recently played list, the
 * best score of each game and the games in progress. `record` is the list of runs `record.ts` keeps, which the
 * levels, the streaks, the day's challenges and the unlocks are all worked out from.
 *
 * They are **one file** rather than two, which is the opposite of Chess World's six, and for a reason that is the
 * same reason read the other way: Chess World splits because a puzzle solved at two in the morning must not rewrite
 * the board colours. Here, a finished run writes the best score, the run, the recently played list and the saved
 * board at the same instant. Two files would be two writes that have to agree, and a run counted in one but not the
 * other is worse than a write that did not happen.
 *
 * ## Which part answers which question
 *
 * The two parts both know something about a score, so it is worth saying plainly which is the answer:
 *
 *   **the best score** is `library.scores[id].best`, and `beats()` in `offlineGames.ts` is what judges it -- which
 *   matters, because a reaction time of 180 beats one of 240 and a score of 180 does not. It never rolls up and it
 *   is what the game itself is handed as `best`, so there is one number on screen and in the engine.
 *
 *   **what you did** is `record.plays`. A run carries `newBest` as the score store measured it at the time, which is
 *   exactly what `PlayRecord.newBest` says: "set only when the score store said this run beat your own record". The
 *   score store is `library.scores`. The run list never decides a best; it records what one was.
 *
 * So "what is my best" has one answer and "what did I do" has one answer, and neither is worked out from the other.
 */

/** The same shape every answer from the store has: what was read, what could not be read, what was not written. */
export interface ArcadeAnswer<T> {
  value: T
  notes: readonly string[]
  /**
   * Set only when **nothing was written at all**.
   *
   * A save whose answer has this set did not happen, and the screen must say so rather than show the new score as
   * kept. A save that reported success and wrote nothing is the one failure nobody goes looking for.
   */
  refused: string | null
}

export interface KeptArcade {
  schemaVersion: 1
  /** Preferences, favourites, recently played, best scores and the games in progress. */
  library: OfflineGamesData
  /** Every run, which the levels, streaks, challenges and unlocks are all worked out from. */
  record: ArcadeRecord
  /** The day's goal the player chose, by its id. Null when they have not chosen one. */
  goalId: string | null
  /**
   * The hour a day is taken to begin, in the player's own time. 0 is midnight.
   *
   * Kept, because it changes what counts as a streak and somebody who plays at one in the morning will want it
   * moved. The time-zone offset beside it is **not** kept: it belongs to wherever the window is running now, so it
   * is handed in fresh on every read rather than carried from the machine the profile came from.
   */
  dayStartHour: number
}

export const emptyKept = (installId = ''): KeptArcade => ({
  schemaVersion: 1,
  library: normalizeData(null),
  record: emptyRecord(installId),
  goalId: null,
  dayStartHour: 0
})

// ---------------------------------------------------------------- reading it back

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Reads what was stored, saying out loud what it had to leave out.
 *
 * It **throws** when what is there is not an arcade record at all, or when the list of runs is not a list. That is
 * how `JsonFile` is told the file is damaged rather than merely unreadable, so a file this version cannot make sense
 * of is moved aside with its words intact instead of written over. `record.ts` already decides which of those two a
 * stored record is -- `unreadable` on its answer is exactly that question -- so this translates its answer rather
 * than asking it again.
 *
 * Anything smaller than that -- one impossible run, one preference out of range -- costs that row and nothing else,
 * and is reported in a sentence somebody can be shown.
 *
 * Unknown fields survive the trip out and back, so a record written by a newer Orbis that this one can still read
 * does not come back as a worse copy of itself.
 */
export function readKept(raw: unknown, o: { installId?: string } = {}): { value: KeptArcade; notes: string[] } {
  if (raw === null || raw === undefined) return { value: emptyKept(o.installId), notes: [] }
  if (!isObject(raw)) throw new Error('what was saved is not a record of games played')
  const notes: string[] = []

  const read = readArcade(raw.record ?? null, { ...(o.installId !== undefined ? { installId: o.installId } : {}) })
  // Unreadable means there is something there nobody has read. Throwing moves it aside with its words on the disk;
  // reading it as an empty record would be the one mistake that cannot be undone.
  if (read.unreadable) throw new Error(read.says)
  if (read.dropped > 0) notes.push(read.says)

  const hour = typeof raw.dayStartHour === 'number' && Number.isFinite(raw.dayStartHour) ? Math.round(raw.dayStartHour) : 0
  if (hour < 0 || hour > 23) {
    notes.push('The hour your day starts was saved as something impossible, so it has gone back to midnight. Nothing else was affected.')
  }

  return {
    value: {
      ...raw,
      schemaVersion: 1,
      // `normalizeData` is the shell's own reader and drops what it cannot read rather than reporting it. That is its
      // contract and not this file's to change: it was written to make broken data unable to break the games.
      library: normalizeData(raw.library ?? null),
      record: read.record,
      goalId: typeof raw.goalId === 'string' && raw.goalId ? raw.goalId : null,
      dayStartHour: hour >= 0 && hour <= 23 ? hour : 0
    } as KeptArcade,
    notes
  }
}

/**
 * Whether a profile holds nothing anybody chose, which is the one condition under which an old copy from the
 * window's own storage may be brought in.
 *
 * Preferences count. A profile where somebody has turned the sound off and played nothing is a profile somebody has
 * used, and bringing another copy's preferences in over it would be taking a decision away.
 */
export function isEmptyKept(kept: KeptArcade): boolean {
  const prefsUntouched = (Object.keys(DEFAULT_PREFS) as (keyof OfflineGamesPrefs)[]).every((key) => kept.library.prefs[key] === DEFAULT_PREFS[key])
  return (
    prefsUntouched &&
    kept.goalId === null &&
    kept.dayStartHour === 0 &&
    kept.record.plays.length === 0 &&
    kept.record.before === null &&
    Object.keys(kept.library.scores).length === 0 &&
    Object.keys(kept.library.saved).length === 0 &&
    kept.library.favorites.length === 0 &&
    kept.library.recent.length === 0
  )
}

/**
 * The old copy from the window's own storage, in the shape the profile wants. Null when the text cannot be read.
 *
 * Null matters: the carry-over then leaves the old copy exactly where it is and says so, rather than bringing
 * nothing across silently.
 *
 * The window only ever stored the library half -- best scores, times played, favourites, recents, saved games and
 * preferences. There are no runs to bring across, and none are invented: a run history worked back from a best score
 * would be a list of games that never happened, which would then earn levels and hold up streaks.
 */
export function keptFromWindowStorage(text: string, installId = ''): KeptArcade | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObject(parsed)) return null
  return { ...emptyKept(installId), library: normalizeData(parsed) }
}

/**
 * Forgets everything that was played, and keeps the preferences.
 *
 * Preferences are a separate decision from a score, and somebody clearing their high scores has not asked for the
 * sound to come back on. The machine's own mark is kept too: it decides which challenge a day gives, and a new mark
 * would change today's challenge halfway through the day.
 *
 * It empties **both** halves in one call. Clearing the best scores and leaving the runs would leave levels, streaks
 * and unlocks standing on runs whose scores are gone, which is a rank nobody could account for.
 */
export const forgetArcade = (kept: KeptArcade): KeptArcade => ({
  ...kept,
  library: { ...kept.library, scores: {}, recent: [], saved: {} },
  record: { ...emptyRecord(kept.record.installId) }
})

// ---------------------------------------------------------------- finding a game among thirty-two

export type GameSort = 'name' | 'recent' | 'best' | 'played'

/**
 * How a game compares to another on a given ordering, with favourites pinned above everything.
 *
 * Sorting is here rather than in the screen because "best score" is not one comparison: a reaction time of 180 beats
 * one of 240, and a score of 180 does not beat one of 240. A screen that sorted descending on the stored number
 * would put the worst reaction times at the top of the leaderboard and look, convincingly, like it was working.
 */
export function sortGames(ids: readonly GameId[], kept: KeptArcade, sort: GameSort, pinFavourites = true): GameId[] {
  const favourite = new Set(kept.library.favorites)
  const name = (id: GameId): string => gameInfo(id).name
  const NEVER = -Infinity
  const rank = (id: GameId): number => {
    const score = kept.library.scores[id]
    switch (sort) {
      case 'recent':
        return score?.lastPlayedAt ?? NEVER
      case 'played':
        return score?.plays ?? NEVER
      case 'best':
        // Lower is better for a reaction time, so it is ranked by its negative and still sorts highest-first.
        return score === undefined ? NEVER : gameInfo(id).score === 'lower-ms' ? -score.best : score.best
      default:
        return 0
    }
  }
  return [...ids].sort((a, b) => {
    if (pinFavourites && favourite.has(a) !== favourite.has(b)) return favourite.has(a) ? -1 : 1
    if (sort !== 'name') {
      const left = rank(a)
      const right = rank(b)
      // Never played sorts last on every ordering but by name, and two never-played games fall through to the name.
      if (left === NEVER || right === NEVER) {
        if (left !== right) return left === NEVER ? 1 : -1
      } else if (left !== right) return right - left
    }
    return name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0
  })
}

/** Every game id the catalogue has, so a key out of a stored record is checked before it is used as one. */
const CONTINUABLE = new Set<string>(GAMES.filter((one) => one.continuable).map((one) => one.id))

/** The games with something to go back to, newest first. Only the ones the catalogue says can be continued. */
export function continuable(kept: KeptArcade): { gameId: GameId; savedAt: number }[] {
  return (Object.keys(kept.library.saved) as GameId[])
    .filter((id) => CONTINUABLE.has(id))
    .map((gameId) => ({ gameId, savedAt: kept.library.saved[gameId]?.savedAt ?? 0 }))
    .sort((a, b) => b.savedAt - a.savedAt)
}

// ---------------------------------------------------------------- saying it in words

/** A length of time in the words somebody would use. Never "0h 0m". */
export function spellTime(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${hours} hour${hours === 1 ? '' : 's'} ${rest} minute${rest === 1 ? '' : 's'}`
}

/** A stored score in that game's own units, because 180 means two different things in two of these games. */
export const spellScore = (gameId: GameId, value: number): string => {
  const kind = gameInfo(gameId).score
  return kind === 'lower-ms' ? `${value} ms` : kind === 'wpm' ? `${value} WPM` : value.toLocaleString()
}
