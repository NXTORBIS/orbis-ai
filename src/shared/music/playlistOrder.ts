/**
 * Putting a playlist's songs in a different order, and the sums under its name.
 *
 * All of it is arithmetic over ids and numbers, with no screen and no music service, so it can be tested on its own.
 * The screen that uses it is `extension-src/music/screens/playlist.ts`.
 *
 * **The one thing that is easy to get wrong.** What is on screen is not the playlist. A playlist holds track ids, and
 * the music service hands back only the ids it still has a song for -- an id whose song has gone is quietly left out.
 * So the third row on screen can be the fourth id in the playlist, and sending the row's own number to the reorder
 * operation would move the wrong song. Everything here that produces a `from` and a `to` works them out against the
 * playlist's own id list, from the id of the row somebody actually dragged.
 */

/** Where a dragged row would land: before the row at this position in what is on screen. */
export interface Landing {
  /** The row being moved, by its position in what is on screen. */
  readonly from: number
  /** The gap it would go into: 0 is above the first row, and the row count is below the last. */
  readonly before: number
}

/** What the reorder operation is given: positions in the playlist's own list of ids. */
export interface Move {
  readonly from: number
  readonly to: number
}

/**
 * The array after one song is taken out and put back somewhere else.
 *
 * The same two steps the music service's own reorder does -- take out, then insert at `to` -- so `to` is where the
 * song ends up, counted after it has been removed. Getting that the other way round is how a drag lands one place
 * short of where the line was drawn.
 */
export function moved<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items]
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out
  const [one] = out.splice(from, 1)
  out.splice(to, 0, one as T)
  return out
}

/**
 * The gap a drop lands in, from where the pointer is.
 *
 * Given the middle of each row down the page, a pointer above the first middle means the gap above the first row, and
 * a pointer below the last middle means the gap below the last. Midpoints rather than edges because dropping on the
 * top half of a row plainly means "above this one", which is what the line drawn on screen has to agree with.
 */
export function dropBefore(middles: readonly number[], pointerY: number): number {
  let before = 0
  while (before < middles.length && pointerY > (middles[before] as number)) before += 1
  return before
}

/**
 * Turns a landing into the move the music service understands, or nothing when it would change nothing.
 *
 * Dropping a row into the gap just above or just below itself is not a move, and sending it anyway would write the
 * playlist afresh, bump its changed-at time and redraw the list for no reason.
 */
export function landingMove(landing: Landing, count: number): Move | null {
  const { from, before } = landing
  if (from < 0 || from >= count) return null
  if (before < 0 || before > count) return null
  if (before === from || before === from + 1) return null
  return { from, to: before > from ? before - 1 : before }
}

/** Where the keyboard would put a row: one up, or one down. Nothing at the ends, so the keys simply do nothing. */
export function stepMove(from: number, direction: -1 | 1, count: number): Move | null {
  if (from < 0 || from >= count) return null
  const to = from + direction
  if (to < 0 || to >= count) return null
  return { from, to }
}

/**
 * The same move, counted against the playlist's own ids rather than against the rows on screen.
 *
 * `shown` is the ids of the rows in the order they appear; `order` is the playlist's own list, which may hold ids
 * with no song behind them. An id missing from `order` means the two have gone out of step -- the playlist was
 * changed in the Orbis window while this page was open -- and the answer is nothing, so the page reads it again
 * instead of moving a song somewhere nobody asked for.
 */
export function realMove(order: readonly string[], shown: readonly string[], move: Move): Move | null {
  const id = shown[move.from]
  const landedBefore = move.to >= move.from ? shown[move.to + 1] : shown[move.to]
  if (id === undefined) return null
  const from = order.indexOf(id)
  if (from < 0) return null
  const without = order.filter((_, at) => at !== from)
  // Where it goes is said by the id it ends up above, not by a number: any id between the two on screen that has no
  // song is still in the playlist, and the song has to keep its place relative to those as well.
  let to = landedBefore === undefined ? without.length : without.indexOf(landedBefore)
  if (to < 0) return null
  if (to > without.length) to = without.length
  if (to === from) return null
  return { from, to }
}

/** The sums under a playlist's name. */
export interface PlaylistSums {
  readonly count: number
  /** Total of the lengths that are known. */
  readonly seconds: number
  /** How many songs have no known length, so a total can say it is at least that much rather than claim to be it. */
  readonly unknown: number
  /** How many can actually be played on this computer. */
  readonly playable: number
}

export function playlistSums(tracks: readonly { duration: number; availability: string; file?: string }[]): PlaylistSums {
  let seconds = 0
  let unknown = 0
  let playable = 0
  for (const track of tracks) {
    if (Number.isFinite(track.duration) && track.duration > 0) seconds += track.duration
    else unknown += 1
    if (track.availability === 'local' && typeof track.file === 'string' && track.file.length > 0) playable += 1
  }
  return { count: tracks.length, seconds, unknown, playable }
}

/**
 * The line under a playlist's name, in words.
 *
 * `spanText` is passed in rather than imported so this file stays arithmetic over its arguments. When some songs have
 * no known length the total is prefixed with "at least", because adding up the lengths it has and calling that the
 * total would be a number Orbis cannot stand behind.
 */
export function sumsWords(sums: PlaylistSums, spanText: (seconds: number) => string): string {
  const parts: string[] = [`${sums.count} ${sums.count === 1 ? 'song' : 'songs'}`]
  const span = spanText(sums.seconds)
  if (span) parts.push(sums.unknown > 0 ? `at least ${span}` : span)
  if (sums.count > 0 && sums.playable < sums.count) parts.push(`${sums.playable} playable here`)
  return parts.join(' · ')
}

/** Songs that are not in this playlist already, so searching to add one never offers a song that is in it. */
export function notAlready<T extends { id: string }>(found: readonly T[], already: readonly string[]): T[] {
  const held = new Set(already)
  return found.filter((one) => !held.has(one.id))
}

/**
 * Whether a new name is worth sending.
 *
 * Trimmed and capped the same way the music service caps it, and the old name back means nothing to do -- so pressing
 * Save without typing anything closes the field rather than writing the playlist again.
 */
export function renameTo(said: unknown, was: string): string | null {
  if (typeof said !== 'string') return null
  const name = said.trim().slice(0, 200)
  if (name.length === 0) return null
  if (name === was.trim()) return null
  return name
}
