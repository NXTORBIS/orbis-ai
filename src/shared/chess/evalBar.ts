import { barFraction, formatScore, type Score, type Side } from './evaluation.ts'

/**
 * What the bar beside the board says.
 *
 * The bar is a filled strip: White's share of it at the bottom, Black's at the top. It is the fastest way there is
 * of reading who stands better, and it is also the easiest thing in a chess program to make dishonest, in exactly
 * one way -- by drawing it half full when nothing has been calculated.
 *
 * A bar at the middle says "the engine looked and it is level". Nothing looked. So a score of `{ kind: 'none' }`
 * does not get a fraction at all here: it gets `kind: 'unknown'` and a sentence, and the board draws a strip with
 * no fill and a dash in it (Sections 046, 111, 112).
 *
 * A forced mate is not a number of pawns and is never turned into one. `settings.ts` already holds that rule for
 * the text of a score; this holds it for the picture: a mate fills the bar for the side that has it, and says so
 * in words rather than spelling out some enormous centipawn figure (Section 112).
 *
 * The number itself is always shown as well as drawn, because a filled strip is a colour and a length and nothing
 * else, and neither of those is readable by somebody who cannot see them (Sections 271, 275).
 */

export type BarReading =
  /** Nothing has been worked out for this position. Not a bar at the middle, and not a zero. */
  | { kind: 'unknown'; say: string; shown: string }
  /** A score in pawns. `whiteShare` is 0 (Black winning) to 1 (White winning). */
  | { kind: 'score'; whiteShare: number; shown: string; say: string }
  /** A forced mate. The bar belongs entirely to the side that has it. */
  | { kind: 'mate'; whiteShare: 0 | 1; shown: string; say: string; winner: Side }
  /** The position on the board is already mate, so there is no advantage left to draw. */
  | { kind: 'over'; shown: string; say: string }

const moveWord = (moves: number): string => `${moves} move${moves === 1 ? '' : 's'}`

/**
 * The reading, from the score and nothing else.
 *
 * `text` is the score written the way this person asked to read it (`formatForSettings` -- "mate in 3" against
 * "M3", pawns against hundredths). Without it the plain form is used. `toMove` is only needed to say who delivered
 * a mate that is already on the board, and the answer is simply "not the side that has to move".
 */
export function barReading(score: Score, opts: { text?: string; toMove?: Side } = {}): BarReading {
  const shown = opts.text ?? formatScore(score)

  if (score.kind === 'none') {
    return {
      kind: 'unknown',
      shown: opts.text ?? '—',
      say: 'No score has been worked out for this position, so the bar is empty rather than level.'
    }
  }

  if (score.kind === 'mate') {
    if (score.moves === 0) {
      // Mate on the board. Which side won is not in the score at all -- it is whoever is not to move -- so without
      // being told whose turn it is, this says the game is over and fills nothing.
      if (!opts.toMove) return { kind: 'over', shown, say: 'This position is mate. The game is over.' }
      const winner: Side = opts.toMove === 'w' ? 'b' : 'w'
      return {
        kind: 'mate',
        whiteShare: winner === 'w' ? 1 : 0,
        shown,
        winner,
        say: `${winner === 'w' ? 'White' : 'Black'} has mated. The game is over.`
      }
    }
    const winner: Side = score.moves > 0 ? 'w' : 'b'
    return {
      kind: 'mate',
      whiteShare: winner === 'w' ? 1 : 0,
      shown,
      winner,
      say: `${winner === 'w' ? 'White' : 'Black'} has a forced mate in ${moveWord(Math.abs(score.moves))}.`
    }
  }

  const whiteShare = barFraction(score)
  const pawns = Math.abs(score.cp / 100).toFixed(2)
  const say =
    score.cp === 0
      ? `The engine makes this level: ${shown}.`
      : `${score.cp > 0 ? 'White' : 'Black'} is ${pawns} pawns better by the engine's count: ${shown}.`
  return { kind: 'score', whiteShare, shown, say }
}

/** Is there a fill to draw at all? False for the two readings that must not look like a position being level. */
export function hasFill(reading: BarReading): reading is Extract<BarReading, { whiteShare: number }> {
  return reading.kind === 'score' || reading.kind === 'mate'
}

/**
 * How much of the strip belongs to the side at the top of it, as a percentage.
 *
 * The bar turns round with the board: whoever is at the bottom of the board has the bottom of the bar, so a person
 * playing Black does not have to read it upside down.
 */
export function topShare(reading: BarReading, orientation: Side): number {
  if (!hasFill(reading)) return 0
  const white = Math.max(0, Math.min(1, reading.whiteShare))
  const top = orientation === 'w' ? 1 - white : white
  return Math.round(top * 1000) / 10
}
