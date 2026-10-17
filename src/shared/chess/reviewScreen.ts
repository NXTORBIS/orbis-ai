/**
 * The counting behind the Game Report screen.
 *
 * `review.ts` works out what the game was: what each move was called, how accurate each side was, which moments
 * decided it, how long the game stayed in theory. None of that is repeated here. This file turns those answers into
 * the shapes a picture needs -- the width of a bar, the length of a ring's stroke, the symbol beside a move, a short
 * line of words -- so the screen itself holds no arithmetic and every number on it can be checked without a window.
 *
 * The rule the whole file obeys: nothing is derived from a move the engine could not judge. A move with no search
 * behind it gets no symbol, no bar segment and no mention in the summary. An empty place on screen is the honest
 * answer and it is what the screen draws.
 */

import { CLASS_LABEL, forSide, formatScore, type MoveClass, type Score, type Side } from './evaluation.ts'
import type { BookRun, GameReview, KeyMoments, ReviewCounts, ReviewMove, SideAccuracy } from './review.ts'

// ---------------------------------------------------------------- the symbol beside a move

/**
 * The one or two characters drawn beside a move in the move list.
 *
 * Deliberately not colour alone: the same judgement is a symbol, a colour and a tooltip, so somebody who cannot
 * tell the colours apart still reads the same list.
 */
export const MOVE_SYMBOL: Readonly<Record<string, string>> = Object.freeze({
  brilliant: '!!',
  great: '!',
  book: '□',
  best: '★',
  excellent: '✓',
  good: '·',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
  'missed-mate': '✕'
})

export interface MoveMark {
  symbol: string
  title: string
  kind: string
}

/**
 * A mark per ply for the shared move list.
 *
 * An award (Brilliant, Great) wins over the class, because it is the stronger statement about the same move. A book
 * move is only marked as theory when the engine had nothing to say about it: being theory describes where the move
 * came from, not what it was worth, so a book move the engine called a mistake is still marked a mistake.
 *
 * A move whose class is `unclear` is left unmarked. That is the one case the list must get right: an unmarked move
 * means nobody has looked at it, and filling it in with anything at all would be an invented judgement.
 */
export function reviewNotes(moves: readonly ReviewMove[]): Record<number, MoveMark> {
  const out: Record<number, MoveMark> = {}
  for (const row of moves) {
    if (row.award) {
      out[row.ply] = { symbol: MOVE_SYMBOL[row.award], title: row.awardWhy, kind: row.award }
      continue
    }
    if (row.klass !== 'unclear') {
      out[row.ply] = { symbol: MOVE_SYMBOL[row.klass], title: row.why, kind: row.klass }
      continue
    }
    if (row.book) out[row.ply] = { symbol: MOVE_SYMBOL.book, title: `Theory: ${row.book.eco} ${row.book.name}.`, kind: 'book' }
  }
  return out
}

// ---------------------------------------------------------------- the bars

/** The order the classes are shown in: best first, and the moves nobody judged last. */
export const CLASS_ORDER: readonly MoveClass[] = Object.freeze([
  'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder', 'missed-mate', 'unclear'
])

export interface ClassBar {
  klass: MoveClass
  label: string
  count: number
  /** 0..1 of the longest bar in the set, so the shortest bar is still visible. 0 when the count is 0. */
  share: number
  /** True for the row that is not a judgement, so the screen can draw it apart from the rest. */
  unjudged: boolean
}

/**
 * How many moves of each kind, as bars.
 *
 * The share is measured against the biggest count rather than against the total, because the picture is a
 * comparison between the classes, and in a game of forty best moves and one blunder the blunder would otherwise be
 * drawn as nothing at all.
 */
export function classBars(counts: ReviewCounts): ClassBar[] {
  let most = 0
  for (const klass of CLASS_ORDER) most = Math.max(most, counts.classes[klass])
  return CLASS_ORDER.map((klass) => {
    const count = counts.classes[klass]
    return {
      klass,
      label: CLASS_LABEL[klass],
      count,
      share: most > 0 && count > 0 ? count / most : 0,
      unjudged: klass === 'unclear'
    }
  })
}

// ---------------------------------------------------------------- the accuracy dial

export interface RingDash {
  /** The length of stroke to draw, in the same units as the circumference handed in. */
  drawn: number
  /** The length to leave blank. */
  blank: number
  /** The figure as whole per cent, for the number in the middle. */
  percent: number
}

/**
 * The stroke of an accuracy ring.
 *
 * Returns null when there is no figure. A ring drawn at nought for a game nobody has analysed would read as "every
 * move was bad", which is the opposite of "nothing has been measured", so the screen draws no ring at all and says
 * why instead.
 */
export function ringDash(value: number | null, circumference: number): RingDash | null {
  if (value === null || !Number.isFinite(value) || circumference <= 0) return null
  const share = Math.max(0, Math.min(1, value))
  const drawn = circumference * share
  return { drawn, blank: Math.max(0, circumference - drawn), percent: Math.round(share * 100) }
}

/** The short line under the dial: how much of the game the figure covers. Never a figure the game did not give. */
export function coverWords(accuracy: SideAccuracy): string {
  if (accuracy.moves === 0) return 'No moves'
  if (accuracy.value === null) return `0 of ${accuracy.moves} moves judged`
  return accuracy.whole
    ? `all ${accuracy.moves} moves judged`
    : `${accuracy.judged} of ${accuracy.moves} moves judged`
}

// ---------------------------------------------------------------- where theory stopped

export interface TheoryEnd {
  /** How many moves of the game the opening dataset named. */
  inBook: number
  /** The ply the game left theory on, or null when it never did within the moves looked at. */
  leftAt: number | null
  /** The move it left on, written as a move list writes it. Null when it did not leave. */
  leftLabel: string | null
  /** What the opening is called, from the last named position. Null when none was named. */
  name: string | null
  eco: string | null
  /** A chip's worth of words. Short on purpose: the full sentence is the book run's own. */
  chip: string
}

/** The opening, as a chip rather than a paragraph. All of it comes from the book run; nothing is looked up again. */
export function theoryEnd(book: BookRun): TheoryEnd {
  const name = book.last ? book.last.name : null
  const eco = book.last ? book.last.eco : null
  const chip = name === null
    ? 'Not a named opening'
    : book.leftLabel === null
      ? `${eco} ${name} throughout`
      : `${eco} ${name}, left theory at ${book.leftLabel}`
  return { inBook: book.moves.length, leftAt: book.leftAt, leftLabel: book.leftLabel, name, eco, chip }
}

// ---------------------------------------------------------------- a win that was let go

/** How far ahead, from the mover's own point of view, counts as winning for the purpose below. */
export const WINNING_CP = 200

export const MISSED_WIN_RULE =
  `A win let go: before the move the side playing it stood at least ${WINNING_CP / 100} pawns ahead, or had a forced `
  + 'mate, and after it they did not. Both positions have to have been searched deeply enough to judge a move, or '
  + 'the move is not looked at. It is worked out on this screen from the two scores the engine gave, and it is not '
  + 'one of the engine own names for a move.'

export interface MissedWin {
  ply: number
  san: string
  number: number
  mover: Side
  before: Score
  after: Score
  says: string
}

/** True when this score has the side named standing clearly better. A missing score is never winning. */
function winning(score: Score | null, side: Side): boolean {
  if (score === null) return false
  const seen = forSide(score, side)
  if (seen.kind === 'mate') return seen.moves > 0
  if (seen.kind === 'cp') return seen.cp >= WINNING_CP
  return false
}

/**
 * The moves where a winning position stopped being winning.
 *
 * Chess sites call this a missed win, and Orbis's engine layer has no such class -- its names come from how much a
 * move gave up, not from where the game stood. So it is measured here from the same two scores the class came from,
 * and the screen says it was worked out this way rather than passing it off as the engine's own verdict.
 */
export function missedWins(moves: readonly ReviewMove[]): MissedWin[] {
  const out: MissedWin[] = []
  for (const row of moves) {
    if (row.klass === 'unclear') continue
    if (row.before === null || row.after === null) continue
    if (!winning(row.before, row.mover)) continue
    if (winning(row.after, row.mover)) continue
    const who = row.mover === 'w' ? 'White' : 'Black'
    out.push({
      ply: row.ply,
      san: row.san,
      number: row.number,
      mover: row.mover,
      before: row.before,
      after: row.after,
      says: `${who} stood at ${formatScore(row.before, row.mover)} before ${row.san} and at `
        + `${formatScore(row.after, row.mover)} after it.`
    })
  }
  return out
}

// ---------------------------------------------------------------- how the pass is going

export interface PassProgress {
  /** 0..1 of the positions asked for, or null before anything was asked. */
  share: number | null
  /** Whole per cent, for a label. Null when there is nothing to report. */
  percent: number | null
  /** One line, shown as it is. It never predicts how long the rest will take. */
  words: string
}

/**
 * What the pass is doing, in one line and one bar.
 *
 * It deliberately does not estimate the time left. How long one position takes depends on the position and on this
 * computer, and a countdown that was wrong would be the screen's only invented number.
 */
export function passProgress(run: { running: boolean; done: number; total: number; skipped: number }): PassProgress {
  if (run.total <= 0) {
    return {
      share: null,
      percent: null,
      words: run.skipped > 0
        ? `Nothing to search: all ${run.skipped} positions already had a search this deep.`
        : 'No pass has been run on this game yet.'
    }
  }
  const share = Math.max(0, Math.min(1, run.done / run.total))
  const words = `${run.done} of ${run.total} positions searched`
    + (run.skipped > 0 ? `, ${run.skipped} already deep enough` : '')
    + (run.running ? '. It can be stopped at any point and what was searched is kept.' : '.')
  return { share, percent: Math.round(share * 100), words }
}

// ---------------------------------------------------------------- what went wrong, in plain words

export interface SummaryPoint {
  /** The position it came from, so every line can be jumped to. Null when it is about the game as a whole. */
  ply: number | null
  text: string
  /** Whether it is a thing that went right, a thing that went wrong, or neither. */
  tone: 'good' | 'bad' | 'plain'
}

/**
 * The summary: short lines, each one tied to something measured.
 *
 * Every line here could be read off the rest of the screen. It exists because the rest of the screen is numbers, and
 * somebody who has just finished a game wants to be told what happened before they go looking for it.
 */
export function summaryPoints(review: GameReview): SummaryPoint[] {
  const out: SummaryPoint[] = []
  const name = (side: Side): string => (side === 'w' ? 'White' : 'Black')
  const sides: readonly Side[] = ['w', 'b']

  const theory = theoryEnd(review.book)
  if (theory.name !== null) {
    out.push({
      ply: theory.leftAt,
      text: theory.leftLabel === null
        ? `The opening was the ${theory.name}, and every move looked at was still theory.`
        : `The opening was the ${theory.name}. The game left theory at ${theory.leftLabel}.`,
      tone: 'plain'
    })
  }

  for (const side of sides) {
    const accuracy = review.accuracy[side]
    if (accuracy.value !== null) {
      out.push({
        ply: null,
        text: `${name(side)} played ${accuracy.good} of ${accuracy.judged} judged moves well, which is `
          + `${Math.round(accuracy.value * 100)} per cent.`,
        tone: accuracy.value >= 0.8 ? 'good' : 'plain'
      })
    }
  }

  const worst = review.key.moments[0]
  if (worst) {
    out.push({
      ply: worst.ply,
      text: `The biggest change came at ${worst.number}${worst.mover === 'w' ? '.' : '…'}${worst.san}: `
        + `${formatScore(worst.before)} to ${formatScore(worst.after)}.`,
      tone: 'bad'
    })
  }

  for (const side of sides) {
    const blunders = review.counts[side].classes.blunder
    const mistakes = review.counts[side].classes.mistake
    if (blunders > 0) {
      out.push({
        ply: null,
        text: `${name(side)} played ${blunders} blunder${blunders === 1 ? '' : 's'}`
          + (mistakes > 0 ? ` and ${mistakes} mistake${mistakes === 1 ? '' : 's'}.` : '.'),
        tone: 'bad'
      })
    }
    const missedMate = review.counts[side].classes['missed-mate']
    if (missedMate > 0) {
      out.push({
        ply: null,
        text: `${name(side)} had a forced mate available ${missedMate} time${missedMate === 1 ? '' : 's'} and did not play it.`,
        tone: 'bad'
      })
    }
  }

  for (const letGo of missedWins(review.moves).slice(0, 2)) {
    out.push({
      ply: letGo.ply,
      text: `${name(letGo.mover)} let a winning position go at ${letGo.number}`
        + `${letGo.mover === 'w' ? '.' : '…'}${letGo.san}.`,
      tone: 'bad'
    })
  }

  for (const side of sides) {
    const brilliant = review.counts[side].brilliant
    if (brilliant > 0) {
      out.push({
        ply: null,
        text: `${name(side)} found ${brilliant} brilliant move${brilliant === 1 ? '' : 's'}.`,
        tone: 'good'
      })
    }
  }

  if (out.length === 0) {
    out.push({
      ply: null,
      text: 'Nothing has been measured about this game yet, so there is nothing to say about it. Run a pass to have'
        + ' every position searched.',
      tone: 'plain'
    })
  }
  return out
}

/** How much of the game has a search behind it, as a bar and a line. Straight off the report's own coverage. */
export function coverageBar(coverage: {
  analysed: number
  total: number
  shallow: readonly number[]
  minDepth: number
}): { share: number; words: string } {
  const share = coverage.total > 0 ? Math.max(0, Math.min(1, coverage.analysed / coverage.total)) : 0
  const words = `${coverage.analysed} of ${coverage.total} positions searched`
    + (coverage.shallow.length > 0
      ? `, ${coverage.shallow.length} of them shallower than ${coverage.minDepth} and so not used to name a move.`
      : '.')
  return { share, words }
}

/** The moments worth a chip across the top of the screen, biggest change first. Never more than `limit`. */
export function momentChips(key: KeyMoments, limit = 6): { ply: number; label: string; title: string }[] {
  return key.moments.slice(0, limit).map((moment) => ({
    ply: moment.ply,
    label: `${moment.number}${moment.mover === 'w' ? '.' : '…'}${moment.san}`,
    title: moment.explain
  }))
}
