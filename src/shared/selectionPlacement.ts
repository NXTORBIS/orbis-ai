/**
 * Where the orb goes, and where the panel it opens goes.
 *
 * All of it is arithmetic on rectangles, which is why it lives here rather than in the page: it can be tested without
 * a browser, and the awkward cases -- a selection at the very bottom of the window, one that runs off the right-hand
 * edge, one made while the side panel is open -- can be checked by writing the numbers down rather than by dragging
 * a mouse and squinting.
 *
 * Two rules decide everything below:
 *
 * **Never outside the window.** Something drawn past the edge cannot be clicked, and something under the browser's
 * own toolbar looks like a bug in the browser. Every result is clamped into the space that is actually visible.
 *
 * **Never over the selection.** The person selected that text for a reason and is still looking at it. The panel
 * opens into whichever side has room, and when neither side has enough it takes the larger one and gets shorter
 * rather than covering what it is about.
 */

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The space that is actually usable: the window, less anything the browser or Orbis is already occupying. */
export interface Room {
  readonly width: number
  readonly height: number
  /** Kept clear at each edge, for the browser's own chrome and so nothing sits flush against the glass. */
  readonly inset?: { top?: number; right?: number; bottom?: number; left?: number }
}

export interface Placed {
  readonly x: number
  readonly y: number
  /** Which way it ended up going, for the animation to grow from the right corner. */
  readonly from: 'above' | 'below'
  /** How tall it may be here. Only smaller than asked for when there was not room for the whole thing. */
  readonly height: number
}

const SAFE = 8

function edges(room: Room): { top: number; right: number; bottom: number; left: number } {
  const i = room.inset ?? {}
  return {
    top: (i.top ?? 0) + SAFE,
    right: (i.right ?? 0) + SAFE,
    bottom: (i.bottom ?? 0) + SAFE,
    left: (i.left ?? 0) + SAFE
  }
}

/**
 * Where the orb sits for a selection.
 *
 * At the end of the selection's last line and slightly above its middle, so it reads as belonging to the words rather
 * than as something that landed on the page. `last` is the final rectangle of the selection, which for a selection
 * running over several lines is the part that ends part-way across -- putting the orb there leaves it beside the end
 * of the text, not floating out past the right margin of the paragraph.
 */
export function placeOrb(last: Rect, size: number, room: Room): { x: number; y: number } {
  const edge = edges(room)
  const gap = 6
  const wantX = last.x + last.width + gap
  const wantY = last.y + last.height / 2 - size / 2

  // Off the right-hand edge: tuck it under the end of the line instead of beside it.
  const maxX = room.width - edge.right - size
  const x = wantX > maxX ? Math.max(edge.left, Math.min(maxX, last.x + last.width - size)) : Math.max(edge.left, wantX)
  const y = wantX > maxX ? clamp(last.y + last.height + gap, edge.top, room.height - edge.bottom - size) : clamp(wantY, edge.top, room.height - edge.bottom - size)
  return { x, y }
}

function clamp(value: number, low: number, high: number): number {
  return high < low ? low : Math.min(high, Math.max(low, value))
}

/**
 * Where the panel goes.
 *
 * `anchor` is the orb. `selection` is everything the selection covers, which the panel stays off. It opens below when
 * there is room below, above when there is not, and it keeps its left edge near the orb while staying inside the
 * window -- so a selection at the far right gets a panel that slides left rather than one hanging off the screen.
 */
/**
 * Where the contextual bar goes for a selection.
 *
 * Above the selection and aligned with where it starts, which is where the hand that just finished dragging is not,
 * and where the eye already is. Below it only when there is no room above -- a bar under the browser's own toolbar is
 * a bar nobody can press.
 *
 * Aligned to the *first* line rather than the bounding box, because a selection running over five paragraphs has a
 * box whose top is off the screen, and the top of what you can see is the only honest place to put something that
 * belongs to it.
 */
export function placeBar(first: Rect, want: { width: number; height: number }, room: Room): { x: number; y: number; from: 'above' | 'below' } {
  const edge = edges(room)
  const gap = 8
  const above = first.y - want.height - gap
  const below = first.y + first.height + gap
  // Above when it fits; below otherwise. There is no third option: left and right of a line of text is the margin,
  // where a bar reads as belonging to the page rather than to the words.
  const fitsAbove = above >= edge.top
  const y = fitsAbove ? above : Math.min(below, room.height - edge.bottom - want.height)
  const x = Math.max(edge.left, Math.min(first.x, room.width - edge.right - want.width))
  return { x, y: Math.max(edge.top, y), from: fitsAbove ? 'above' : 'below' }
}

/** The first line of a selection: the rectangle nearest the top, and leftmost among those. */
export function firstLine(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null
  return [...rects].sort((a, b) => a.y - b.y || a.x - b.x)[0]
}

export function placePanel(anchor: Rect, selection: Rect, want: { width: number; height: number }, room: Room): Placed {
  const edge = edges(room)
  const gap = 8

  const below = room.height - edge.bottom - (selection.y + selection.height) - gap
  const above = selection.y - edge.top - gap

  // Below unless above has meaningfully more room: switching sides for a few pixels is worse than a slightly short panel.
  const goBelow = below >= want.height || below >= above
  const height = Math.max(120, Math.min(want.height, goBelow ? below : above))

  const width = Math.min(want.width, room.width - edge.left - edge.right)
  const x = clamp(anchor.x - 12, edge.left, room.width - edge.right - width)
  const y = goBelow ? selection.y + selection.height + gap : selection.y - gap - height

  return { x, y: clamp(y, edge.top, room.height - edge.bottom - height), from: goBelow ? 'below' : 'above', height }
}

/**
 * Whether the selection is still somewhere the orb can point at.
 *
 * Scrolled off the top or the bottom, or collapsed to nothing by the page redrawing itself: in all of those the orb
 * should go rather than hang in a place that no longer means anything.
 */
export function stillVisible(selection: Rect, room: Room): boolean {
  if (selection.width <= 0 && selection.height <= 0) return false
  const edge = edges(room)
  const bottom = selection.y + selection.height
  if (bottom < edge.top) return false
  if (selection.y > room.height - edge.bottom) return false
  if (selection.x + selection.width < edge.left) return false
  if (selection.x > room.width - edge.right) return false
  return true
}

/** The whole of a selection, from the rectangles the browser gives for each line of it. */
export function selectionBounds(rects: readonly Rect[]): Rect | null {
  const real = rects.filter((r) => r.width > 0 || r.height > 0)
  if (real.length === 0) return null
  const left = Math.min(...real.map((r) => r.x))
  const top = Math.min(...real.map((r) => r.y))
  const right = Math.max(...real.map((r) => r.x + r.width))
  const bottom = Math.max(...real.map((r) => r.y + r.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** The last line of a selection: the one the orb is put beside. */
export function lastLine(rects: readonly Rect[]): Rect | null {
  const real = rects.filter((r) => r.width > 0 || r.height > 0)
  if (real.length === 0) return null
  return real.reduce((best, r) => (r.y + r.height > best.y + best.height + 1 || (Math.abs(r.y - best.y) <= 1 && r.x > best.x) ? r : best), real[0]!)
}
