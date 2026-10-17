/**
 * The maths behind what is coming next.
 *
 * All of it here, with no screen and no browser, because the index arithmetic of dragging one entry of a list to sit
 * before another is the part that is easy to get wrong by one and impossible to see wrong by eye. The queue screen
 * reads this and draws it; it works nothing out for itself.
 *
 * Two things about the player's queue decide the shape of everything below. It is one flat array of track ids in the
 * order they will play -- turning shuffle on reorders the array itself, so "next" is always simply the next one along
 * -- and `at` is where the playing track sits in it, or -1 when nothing is playing. So the array holds what has
 * already gone by as well as what is to come, and a screen that showed all of it as "up next" would be lying about
 * most of it.
 *
 * The other thing: `queue-reorder` takes the entry out and then puts it back in, so its second argument is a position
 * in the *shortened* array. Dragging a row to sit in a gap is a position in the array as it stands. Those two numbers
 * differ by one whenever the row is moving down, and `queueMoveTo` is that one line, tested, in one place.
 */

/** One entry of the queue, with where it really sits so a press can name it to the player. */
export interface QueueSlot {
  /** The track id. The same song can be in the queue more than once, so this does not identify a slot. */
  readonly trackId: string
  /** Where it sits in the player's own queue. This is what every queue operation is given. */
  readonly index: number
}

/** The queue split into the three parts a person reads differently. */
export interface QueueParts {
  /** What has already gone by, oldest first. Shown collapsed, or not at all. */
  readonly gone: readonly QueueSlot[]
  /** The track playing now, or null when nothing is. */
  readonly playing: QueueSlot | null
  /** What is coming, in order. */
  readonly next: readonly QueueSlot[]
}

/**
 * Splits the player's queue into what has gone, what is playing and what is next.
 *
 * `at` is trusted only as far as it makes sense: a position outside the array means nothing is playing, which is what
 * the player itself says with -1 and what a stale answer looks like when the queue has just been cleared.
 */
export function queueParts(queue: readonly string[], at: number): QueueParts {
  const slots: QueueSlot[] = queue.map((trackId, index) => ({ trackId, index }))
  if (!Number.isInteger(at) || at < 0 || at >= slots.length) return { gone: [], playing: null, next: slots }
  return { gone: slots.slice(0, at), playing: slots[at] ?? null, next: slots.slice(at + 1) }
}

/**
 * Whether an entry may be dragged.
 *
 * Only what is still to come. Moving the track that is playing would mean nothing -- it is playing, and the player
 * follows it by id rather than by position -- and moving something that has already gone by would not change a note
 * of what anybody hears.
 */
export const canMove = (index: number, at: number): boolean => Number.isInteger(index) && index > at && index >= 0

/**
 * The number to hand `queue-reorder`, given where the row was and which gap it was dropped into.
 *
 * A gap is counted the way a person sees it: gap 0 is above the first row, gap 1 is between the first and the second,
 * and gap n is below the last. The player takes the row out before putting it back, so every gap below where the row
 * started has shifted up by one by the time it is put back. Returns null when the drop would not move anything,
 * so a hand that wobbles and lets go in the same place sends nothing at all.
 */
export function queueMoveTo(from: number, gap: number, length: number): number | null {
  if (!Number.isInteger(from) || !Number.isInteger(gap)) return null
  if (from < 0 || from >= length || gap < 0 || gap > length) return null
  if (gap === from || gap === from + 1) return null
  return gap > from ? gap - 1 : gap
}

/**
 * The list as it would be after a move. Not sent anywhere: it is how the test checks that `queueMoveTo` really does
 * put a row where the hand let go of it, rather than one place off.
 */
export { moved } from './playlistOrder.ts'

/**
 * Which gap the pointer is nearest, from the middle of each row.
 *
 * Measured from the rows themselves rather than worked out from a row height, because rows are not all one height
 * once a title wraps. Above the middle of a row means the gap before it; below means the gap after.
 *
 * `middles` is each row's middle, in the same coordinates as `y`, in row order. The caller reads those out of the
 * page once when the drag starts -- re-measuring during a drag is what makes a list jitter.
 */
export function gapNearest(middles: readonly number[], y: number): number {
  let gap = 0
  for (const middle of middles) {
    if (y < middle) break
    gap += 1
  }
  return gap
}

/** How long everything still to come adds up to, in seconds, and how much of it is a guess. */
export interface QueueLength {
  readonly seconds: number
  /** How many of the tracks have no known length, so the total is "at least this much" rather than the whole of it. */
  readonly unknown: number
}

/**
 * Adds up what is left to play.
 *
 * A track with no known length -- a song Orbis noticed on a web page has a name and nothing else -- is counted as
 * unknown rather than as zero, so a screen can say "at least" instead of stating a total it has not got.
 */
export function queueLength(durations: readonly number[]): QueueLength {
  let seconds = 0
  let unknown = 0
  for (const one of durations) {
    if (Number.isFinite(one) && one > 0) seconds += one
    else unknown += 1
  }
  return { seconds: Math.round(seconds), unknown }
}
