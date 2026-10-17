import { recordFor, type OpeningRecord } from './openings.ts'
import { applyMove, checkFen, START_FEN } from './rules.ts'

/**
 * The names a line passed through on the way to where it is now.
 *
 * The explorer could already say what the position in front of you is called and where it can go. What it could not
 * say is the thing a person actually wants from an opening screen: how the line got its name. A line is named over
 * and over as it is played -- a position named "Italian Game" at move three becomes "Italian Game: Classical
 * Variation" at move four -- and the chain of those names is the shape of the opening.
 *
 * So this walks the line and keeps the positions the dataset really names, in order, skipping the ones whose name
 * has not changed. Nothing is counted and nothing is scored: this dataset holds no games, so there is no
 * popularity here and there never will be from this source.
 */

/** One place along the line that the dataset has a name for. */
export interface TrailStop {
  /** How many moves had been played when the name applied. 1 is after White's first move. */
  ply: number
  /** The move that reached it, as it is written. */
  san: string
  fen: string
  record: OpeningRecord
}

export interface Trail {
  /** The named positions along the line, in the order they were reached, with repeats of the same name removed. */
  stops: TrailStop[]
  /** The last name the line was given, which is what the line is usually called. */
  deepest: TrailStop | null
  /** How many moves were really played out. */
  walked: number
  /**
   * The move that would not play, when one would not. Everything after it was not walked, so a trail with this set
   * is a trail over part of the line and says so.
   */
  stoppedAt: { ply: number; move: string; reason: string } | null
}

/** Two stops are the same place when the dataset gives them the same code and the same name. */
function samePlace(a: OpeningRecord, b: OpeningRecord): boolean {
  return a.eco === b.eco && a.name === b.name
}

/**
 * Walking a line and collecting the names it was given.
 *
 * It plays each move through the rules, so a line that cannot be played stops where it stops instead of being
 * reported as a line that reached somewhere it never reached.
 */
export function openingTrail(moves: readonly string[], startFen: string = START_FEN): Trail {
  const check = checkFen(startFen)
  if (!check.ok) {
    return {
      stops: [],
      deepest: null,
      walked: 0,
      stoppedAt: { ply: 0, move: '', reason: check.reason ?? 'That starting position cannot be used.' }
    }
  }

  const stops: TrailStop[] = []
  let fen = startFen
  let walked = 0

  for (const [index, written] of moves.entries()) {
    const made = applyMove(fen, written)
    if (!made) {
      return {
        stops,
        deepest: stops.length ? stops[stops.length - 1] : null,
        walked,
        stoppedAt: { ply: index + 1, move: written, reason: `"${written}" cannot be played in the position it reaches.` }
      }
    }
    fen = made.after
    walked += 1
    const record = recordFor(fen)
    if (record) {
      const held = stops.length ? stops[stops.length - 1] : null
      // The same name twice in a row is one place, not two. Without this a long line in one variation would read as
      // a list of the same name repeated, which says nothing.
      if (!held || !samePlace(held.record, record)) {
        stops.push({ ply: index + 1, san: made.san, fen, record })
      }
    }
  }

  return {
    stops,
    deepest: stops.length ? stops[stops.length - 1] : null,
    walked,
    stoppedAt: null
  }
}

/** How a move is written when it is said on its own: "3.Bc4" or "3…Nf6". */
export function stopLabel(stop: TrailStop): string {
  const number = Math.floor((stop.ply - 1) / 2) + 1
  return `${number}${stop.ply % 2 === 1 ? '.' : '…'}${stop.san}`
}

/**
 * The trail in words, for anybody who cannot see the row of names.
 *
 * It says how many names there were and what the last one was, and when nothing was named it says that plainly --
 * which is ordinary and not a fault, because most positions in most games have no name.
 */
export function trailWords(trail: Trail): string {
  if (trail.stoppedAt && trail.stoppedAt.ply === 0) return trail.stoppedAt.reason
  if (!trail.stops.length) {
    return trail.walked === 0
      ? 'Nothing has been played yet, so there is no opening to name.'
      : 'The dataset has no name for any position in this line.'
  }
  const last = trail.stops[trail.stops.length - 1]
  const count = trail.stops.length
  const named = `${count} named ${count === 1 ? 'position' : 'positions'} along this line; the last is ${last.record.eco} ${last.record.name} at ${stopLabel(last)}.`
  return trail.stoppedAt ? `${named} ${trail.stoppedAt.reason}` : named
}
