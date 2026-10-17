import { recordFor } from '../../../../../shared/chess/openings'
import type { StoredGame } from '../../../../../shared/chess/model'
import type { OpeningLookup } from '../../../../../shared/chess/archive'

/**
 * Naming the opening of a game that does not say what it was.
 *
 * Most games Orbis plays carry no opening tag, because nothing wrote one: a game against the engine is a position
 * and a line of moves. So the openings dataset is asked, and it is asked the cheap way -- every stored move already
 * carries the position after it, so the dataset can be looked up by position without replaying the game. The deepest
 * named position in the first twenty-four moves wins, which is how openings are named: a line stays the Italian Game
 * for several moves after the dataset stops naming the positions in it.
 *
 * Nothing is invented. A game whose positions are in no entry of the dataset has no opening here, and the numbers
 * screen counts it as "not named" rather than putting it in a group called something.
 */

/** How far in to look. The dataset's deepest entries are inside this, and a long game should not be walked whole. */
const LOOK_AT = 24

export function openingLookup(): OpeningLookup {
  // One game is asked about by the table and again by the numbers, so the answer is kept rather than worked out twice.
  const held = new Map<string, { eco: string; name: string } | null>()
  return (game: StoredGame) => {
    const had = held.get(game.fingerprint)
    if (had !== undefined) return had
    let found: { eco: string; name: string } | null = null
    const fens = [game.startFen, ...game.moves.slice(0, LOOK_AT).map((move) => move.fen)]
    for (const fen of fens) {
      const record = recordFor(fen)
      if (record) found = { eco: record.eco, name: record.name }
    }
    held.set(game.fingerprint, found)
    return found
  }
}
