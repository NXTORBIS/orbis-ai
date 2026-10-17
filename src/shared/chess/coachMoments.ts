import { phaseOf, type AnalysedGame, type AnalysedMove, type CoachEvidence, type GamePhase } from './coach.ts'
import type { MoveClass } from './evaluation.ts'
import type { Side } from './evaluation.ts'

/**
 * The positions behind what the coach says.
 *
 * The coach used to be four tabs of tables and paragraphs with no chess on it anywhere. A screen about your chess
 * with no position on it is a page of writing about you, and the first thing anybody wants to know -- "which move,
 * then?" -- had no answer on it.
 *
 * So this picks out the moves the engine really judged worst in the person's own games and hands back the position
 * each was played in, so the coach can put a board on screen. Every one of these is a position from a game they
 * played, judged by a search that really ran: the position is the one the analysis recorded, the class is what
 * `evaluation.classify` called the move, and the loss is the centipawns the analysis measured. Nothing here is
 * generated, chosen as an illustration, or filled in when there is nothing to show -- with no analysed games there
 * are no moments, and the words say that rather than offering an example.
 *
 * Pure, so what is picked and what is said about it are tested without a window.
 */

/** The classes that mean the engine found something seriously better, worst first. */
export const WORST_FIRST: readonly MoveClass[] = Object.freeze(['missed-mate', 'blunder', 'mistake'])

/** How many moments are offered unless asked for a different number. */
export const DEFAULT_LIMIT = 12

/** A shallow search is not evidence about a player. The same floor the rest of the coach uses. */
export const MIN_DEPTH = 12

export interface CoachMoment {
  /** Steady across reads, so a screen can keep its place in the list. */
  id: string
  gameId: string
  /** Which move of the game, counting both sides. */
  ply: number
  /** The move number as a player counts it. */
  moveNumber: number
  side: Side
  /** The move that was played, as the analysis recorded it. */
  san: string
  /** The position it was played in. This is what the board shows. */
  fen: string
  klass: MoveClass
  /** Centipawns the analysis measured as given away. Null when the two lines could not be put on one scale. */
  loss: number | null
  /** The depth the search that judged it reached. */
  depth: number
  /** Worked out from the position by `phaseOf`, never stored as somebody's opinion. */
  phase: GamePhase | null
  /** What the engine measured, in plain words. No advice, no guess at what you were thinking. */
  says: string
  /** Where it came from, so the figure on screen can carry its origin. */
  origin: string
}

export interface CoachMoments {
  moments: readonly CoachMoment[]
  /** Analysed games that were deep enough to be read. */
  gamesRead: number
  /** Analysed games left out because the search was too shallow to be evidence. */
  gamesTooShallow: number
  /** Analysed games left out because the record does not say which side the person played. */
  gamesWithoutASide: number
  /** The person's own moves the analysis judged, across the games that were read. */
  movesJudged: number
  /** Moves the engine found something seriously better than, which is what these moments are drawn from. */
  seriousMoves: number
  /** The whole of it in one sentence, including when that sentence is "nothing yet". */
  says: string
  /** What every figure here rests on. Shown beside the board. */
  origin: string
}

const CLASS_WORDS: Readonly<Partial<Record<MoveClass, string>>> = Object.freeze({
  'missed-mate': 'a forced mate was on the board and this was played instead',
  blunder: 'the engine found a much better move',
  mistake: 'the engine found a better move'
})

const PHASE_WORDS: Readonly<Record<GamePhase, string>> = Object.freeze({
  opening: 'in the opening',
  middlegame: 'in the middlegame',
  endgame: 'in the endgame'
})

/** Pawns, from the centipawns the analysis measured. One decimal place, because the second one is noise. */
const inPawns = (loss: number): string => `${(loss / 100).toFixed(1)} ${loss >= 95 && loss < 105 ? 'pawn' : 'pawns'}`

/** The move number a player would say, from the ply count. Ply 0 is White's first move. */
export const moveNumberOf = (ply: number): number => Math.floor(ply / 2) + 1

function wordsFor(move: AnalysedMove, game: AnalysedGame, phase: GamePhase | null): string {
  const who = move.side === 'w' ? 'White' : 'Black'
  const where = phase === null ? '' : ` ${PHASE_WORDS[phase]}`
  const what = CLASS_WORDS[move.klass] ?? 'the engine judged this move'
  // The loss is the measurement. When there was none, that is said -- a dash standing in for a number somebody
  // might read as nought is exactly the kind of quiet lie this screen exists to avoid.
  const cost = move.loss === null
    ? 'how much it cost could not be put on one scale, because one of the two lines was a forced mate'
    : `${inPawns(move.loss)} given away`
  return `Move ${moveNumberOf(move.ply)}, ${who}${where}: ${move.san} — ${what}, ${cost}. Judged at depth ${game.depth}.`
}

export interface MomentRules {
  limit?: number
  minDepth?: number
}

/**
 * The worst measured moves in the person's own games, worst first.
 *
 * The order is the engine's measurement and nothing else: a missed mate first -- a mate that was there is not a
 * number on the same scale as a pawn count, so it cannot be ranked against one -- then by the centipawns measured,
 * largest first. A move whose cost could not be measured comes after the ones that could, inside its own class,
 * because putting it anywhere among them would imply a size for it.
 */
export function coachMoments(evidence: CoachEvidence | undefined, rules: MomentRules = {}): CoachMoments {
  const limit = Math.max(1, Math.floor(rules.limit ?? DEFAULT_LIMIT))
  const minDepth = rules.minDepth ?? MIN_DEPTH
  const games = evidence?.games ?? []

  let gamesRead = 0
  let gamesTooShallow = 0
  let gamesWithoutASide = 0
  let movesJudged = 0
  const found: CoachMoment[] = []

  for (const game of games) {
    if (game.depth < minDepth) {
      gamesTooShallow += 1
      continue
    }
    if (game.you === null) {
      gamesWithoutASide += 1
      continue
    }
    gamesRead += 1
    for (const move of game.moves) {
      // Only the person's own moves. The opponent's blunders say nothing about what this person should work on.
      if (move.side !== game.you) continue
      movesJudged += 1
      if (!WORST_FIRST.includes(move.klass)) continue
      const phase = phaseOf(move.before)
      found.push({
        id: `${game.gameId}:${move.ply}`,
        gameId: game.gameId,
        ply: move.ply,
        moveNumber: moveNumberOf(move.ply),
        side: move.side,
        san: move.san,
        fen: move.before,
        klass: move.klass,
        loss: move.loss,
        depth: game.depth,
        phase,
        says: wordsFor(move, game, phase),
        origin: `Your own game, move ${moveNumberOf(move.ply)}, judged by a search to depth ${game.depth}.`
      })
    }
  }

  const seriousMoves = found.length
  found.sort((a, b) => {
    const rank = WORST_FIRST.indexOf(a.klass) - WORST_FIRST.indexOf(b.klass)
    if (rank !== 0) return rank
    if (a.loss === b.loss) return a.ply - b.ply
    if (a.loss === null) return 1
    if (b.loss === null) return -1
    return b.loss - a.loss
  })

  const moments = found.slice(0, limit)
  const nothingRead = [
    gamesTooShallow > 0
      ? `${gamesTooShallow} ${gamesTooShallow === 1 ? 'was' : 'were'} searched too shallow to count`
      : null,
    gamesWithoutASide > 0
      ? `${gamesWithoutASide} ${gamesWithoutASide === 1 ? 'does' : 'do'} not say which side you played`
      : null
  ].filter((bit) => bit !== null).join(', ')

  const says = gamesRead === 0
    ? games.length === 0
      ? 'None of your games has been through the engine yet, so there is no position to show you.'
      : `None of your ${games.length === 1 ? 'analysed game' : `${games.length} analysed games`} could be read as `
        + `evidence about you: ${nothingRead}.`
    : seriousMoves === 0
      ? `The engine went over ${movesJudged} of your own moves in ${gamesRead} ${gamesRead === 1 ? 'game' : 'games'} `
        + 'and found nothing it called a mistake or worse. There is nothing to show on the board.'
      : `${seriousMoves} of your ${movesJudged} judged moves were a mistake or worse. `
        + `${moments.length === seriousMoves ? 'All of them are' : `The worst ${moments.length} are`} here, worst first.`

  return {
    moments,
    gamesRead,
    gamesTooShallow,
    gamesWithoutASide,
    movesJudged,
    seriousMoves,
    says,
    origin: `Measured from ${gamesRead} of your own ${gamesRead === 1 ? 'game' : 'games'} that the engine searched to `
      + `depth ${minDepth} or deeper. Nothing on this board was chosen as an example.`
  }
}

/** How many of each class the engine found, for a chip beside the board. Only classes that really occurred. */
export function momentCounts(moments: readonly CoachMoment[]): readonly { klass: MoveClass; count: number }[] {
  return WORST_FIRST
    .map((klass) => ({ klass, count: moments.filter((one) => one.klass === klass).length }))
    .filter((one) => one.count > 0)
}
