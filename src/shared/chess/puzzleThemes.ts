import {
  CONVENTION_THEMES, PUZZLE_THEMES, THEME_LABEL, THEME_MEANING, UNCHECKABLE_BECAUSE,
  counts, isFact, statusOf,
  type Puzzle, type PuzzleRecord, type PuzzleStore, type PuzzleTheme
} from './puzzles.ts'

/**
 * The themed shelves: for each kind of puzzle somebody actually has, how many there are and how they have got on
 * with them.
 *
 * ## Why this is a separate file
 *
 * `puzzleFacets` in `puzzles.ts` already counts how many puzzles carry each theme, because a filter bar needs that.
 * What a shelf needs is different: how many of those have been solved, how many went wrong, which one to open next,
 * and whether there is enough history to say anything about how somebody does at that kind of puzzle. All of it is
 * counted off the collection and the record of real attempts. Nothing here invents a number, and nothing here
 * invents a shelf: a theme with no puzzles in the collection does not appear.
 *
 * ## The one judgement call, said out loud
 *
 * A shelf's share solved is the share of its puzzles whose last finished attempt was a solve that counted. That is
 * a statement about the collection, not about the person -- somebody who has solved nine of ten has not thereby
 * become good at forks. So `themeStrength` is a separate answer, it is counted over attempts rather than puzzles,
 * and it refuses to say anything at all until there are enough of them.
 */

/** How many finished attempts at one kind of puzzle there must be before anything is said about how it goes. */
export const ENOUGH_ATTEMPTS = 5

export interface ThemeShelf {
  theme: PuzzleTheme
  label: string
  /** What the theme means, for a tooltip. */
  meaning: string
  /** How many puzzles in the collection carry this theme at all. */
  total: number
  /** Of those, how many Orbis itself proved carry it, rather than a source having said so. */
  proved: number
  solved: number
  missed: number
  untried: number
  /** The puzzle to open when somebody picks this shelf: an untried one first, else one that went wrong. */
  nextId: string | null
  /** Whether the theme is counted by a convention of Orbis's rather than proved from the position. */
  byConvention: boolean
  /** Why this theme can never be proved from a position, when that is the case. */
  cannotProve: string | null
}

/** The share of a shelf that has been solved, as a number between 0 and 1. Nought puzzles is nought. */
export function shelfShare(shelf: ThemeShelf): number {
  if (shelf.total === 0) return 0
  return shelf.solved / shelf.total
}

/** What a shelf has to say about itself, in words, with no number it has not counted. */
export function shelfWords(shelf: ThemeShelf): string {
  if (shelf.total === 0) return 'Nothing here carries this.'
  const parts: string[] = [`${shelf.solved} of ${shelf.total} solved`]
  if (shelf.missed > 0) parts.push(`${shelf.missed} went wrong`)
  if (shelf.untried > 0) parts.push(`${shelf.untried} not tried`)
  return `${parts.join(', ')}.`
}

function claimFor(puzzle: Puzzle, theme: PuzzleTheme): boolean {
  return puzzle.themes.some((claim) => claim.theme === theme)
}

/**
 * Every theme that at least one puzzle in the collection carries, with the counts behind each.
 *
 * Ordered by how many puzzles there are, biggest shelf first, and then by name so the order does not wobble between
 * two shelves of the same size.
 */
export function themeShelves(store: PuzzleStore): ThemeShelf[] {
  const out: ThemeShelf[] = []
  for (const theme of PUZZLE_THEMES) {
    const mine = store.puzzles.filter((one) => claimFor(one, theme))
    if (mine.length === 0) continue
    let solved = 0
    let missed = 0
    let untried = 0
    let proved = 0
    let firstUntried: string | null = null
    let firstMissed: string | null = null
    for (const puzzle of mine) {
      if (puzzle.themes.some((claim) => claim.theme === theme && isFact(claim))) proved += 1
      const status = statusOf(store.records[puzzle.id])
      if (status === 'solved') solved += 1
      else if (status === 'missed') {
        missed += 1
        if (firstMissed === null) firstMissed = puzzle.id
      } else {
        untried += 1
        if (firstUntried === null) firstUntried = puzzle.id
      }
    }
    out.push({
      theme,
      label: THEME_LABEL[theme],
      meaning: THEME_MEANING[theme],
      total: mine.length,
      proved,
      solved,
      missed,
      untried,
      nextId: firstUntried ?? firstMissed ?? mine[0].id,
      byConvention: CONVENTION_THEMES.includes(theme),
      cannotProve: UNCHECKABLE_BECAUSE[theme] ?? null
    })
  }
  return out.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
}

export type Strength =
  /** There are enough finished attempts at this kind of puzzle to say how it goes. */
  | { kind: 'measured'; attempts: number; solved: number; share: number; says: string }
  /** There are some attempts but not enough. The number of them is real; nothing is concluded from it. */
  | { kind: 'not-enough'; attempts: number; says: string }

/**
 * How somebody does at one kind of puzzle, counted over finished attempts rather than over puzzles.
 *
 * Attempts, because solving the same puzzle five times is five goes at the idea and one puzzle. Below
 * `ENOUGH_ATTEMPTS` this refuses to give a share at all: three out of four is 75% of nothing worth knowing.
 */
export function themeStrength(store: PuzzleStore, theme: PuzzleTheme): Strength {
  let attempts = 0
  let solved = 0
  for (const puzzle of store.puzzles) {
    if (!claimFor(puzzle, theme)) continue
    const record: PuzzleRecord | undefined = store.records[puzzle.id]
    if (!record) continue
    for (const attempt of record.attempts) {
      attempts += 1
      if (counts(attempt)) solved += 1
    }
  }
  if (attempts < ENOUGH_ATTEMPTS) {
    return {
      kind: 'not-enough',
      attempts,
      says: attempts === 0
        ? 'No goes at this kind yet.'
        : `${attempts} ${attempts === 1 ? 'go' : 'goes'} at this kind so far — not enough to say how it goes.`
    }
  }
  return {
    kind: 'measured',
    attempts,
    solved,
    share: solved / attempts,
    says: `${solved} of ${attempts} goes solved.`
  }
}

export interface SolveProgress {
  puzzles: number
  /** Puzzles whose last finished attempt was a solve that counted. */
  solved: number
  /** Puzzles tried whose last finished attempt was not. */
  missed: number
  untried: number
  /** Every finished attempt ever recorded, across the whole collection. */
  attempts: number
  /** Of those, the ones that counted as a solve. */
  attemptsSolved: number
  /** Solves reached with no hint and no wrong move. */
  clean: number
  /** The last day an attempt was recorded, as YYYY-MM-DD, when any attempt carried a day. */
  lastDay: string | null
}

/** Everything the progress strip shows, counted off the real record and nothing else. */
export function solveProgress(store: PuzzleStore): SolveProgress {
  let solved = 0
  let missed = 0
  let untried = 0
  let attempts = 0
  let attemptsSolved = 0
  let clean = 0
  let lastDay: string | null = null
  for (const puzzle of store.puzzles) {
    const record = store.records[puzzle.id]
    const status = statusOf(record)
    if (status === 'solved') solved += 1
    else if (status === 'missed') missed += 1
    else untried += 1
    if (!record) continue
    for (const attempt of record.attempts) {
      attempts += 1
      if (counts(attempt)) {
        attemptsSolved += 1
        if (attempt.hintsUsed === 0 && attempt.wrongMoves === 0) clean += 1
      }
      if (attempt.day !== undefined && (lastDay === null || attempt.day > lastDay)) lastDay = attempt.day
    }
  }
  return { puzzles: store.puzzles.length, solved, missed, untried, attempts, attemptsSolved, clean, lastDay }
}

/** The progress strip in words, so the figures are never the only thing saying it. */
export function progressWords(progress: SolveProgress): string {
  if (progress.puzzles === 0) return 'There are no puzzles here yet, so there is nothing to have got on with.'
  if (progress.attempts === 0) {
    return `${progress.puzzles} ${progress.puzzles === 1 ? 'puzzle' : 'puzzles'} here and none tried yet.`
  }
  return `${progress.solved} of ${progress.puzzles} solved, from ${progress.attempts} ${progress.attempts === 1 ? 'go' : 'goes'}.`
}

/**
 * Which puzzle to open next, out of a list already narrowed to whatever somebody is looking at.
 *
 * Untried first, oldest added first within that, so working through a shelf goes in the order the puzzles were
 * made. Then the ones that went wrong, because those are the ones worth another go. A puzzle already solved is
 * only offered when there is nothing else, and `kind` says which of the three it was so a screen can say so.
 */
export function nextToSolve(
  store: PuzzleStore,
  pool: readonly Puzzle[],
  skipId?: string
): { puzzle: Puzzle; kind: 'untried' | 'missed' | 'again' } | null {
  const left = pool.filter((one) => one.id !== skipId)
  const order = (a: Puzzle, b: Puzzle): number => a.addedAt - b.addedAt || a.id.localeCompare(b.id)
  const untried = left.filter((one) => statusOf(store.records[one.id]) === 'unseen').sort(order)
  if (untried.length > 0) return { puzzle: untried[0], kind: 'untried' }
  const missed = left.filter((one) => statusOf(store.records[one.id]) === 'missed').sort(order)
  if (missed.length > 0) return { puzzle: missed[0], kind: 'missed' }
  const again = [...left].sort(order)
  if (again.length > 0) return { puzzle: again[0], kind: 'again' }
  return null
}

/** What to say about the puzzle that was picked, so nobody wonders why they are seeing one again. */
export function nextWords(kind: 'untried' | 'missed' | 'again'): string {
  if (kind === 'untried') return 'One you have not tried.'
  if (kind === 'missed') return 'One that went wrong last time.'
  return 'You have solved everything here, so this is one of them again.'
}
