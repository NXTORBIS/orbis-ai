/**
 * The arithmetic of a dragged rectangle, and of turning it into pixels.
 *
 * All of it lives here rather than in the page for the same reason the selection orb's placement does: it can be
 * tested by writing numbers down instead of by dragging a mouse and squinting. The awkward cases are the ones worth
 * having tests for -- a drag that went up and to the left, a drag that left the window, a selection resized by its
 * top-left handle past its own bottom-right corner, a page at 150% zoom on a 2x display.
 *
 * Three rules decide everything below:
 *
 * **A rectangle is always normalised.** Dragging bottom-right to top-left is the same selection as the other way
 * round. Nothing downstream should ever see a negative width.
 *
 * **Nothing leaves the window.** A selection clamped at the edge is a selection you can still see; one that runs off
 * it has handles that cannot be grabbed and a capture region the browser will refuse.
 *
 * **CSS pixels and image pixels are never the same thing, and are never mixed.** The capture comes back at the
 * display's own scale, which is the page zoom times the device ratio times whatever else the compositor did. So the
 * scale is *measured* from the image that actually arrived rather than assumed from `devicePixelRatio` -- which was
 * the one thing that could not be got right by reasoning about it.
 */

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

/** A point in the window, in CSS pixels. */
export interface Point {
  readonly x: number
  readonly y: number
}

/**
 * How far the pointer must travel before this is a Visual Search rather than a click.
 *
 * Six CSS pixels. Small enough that a deliberate drag is recognised immediately; large enough that a Ctrl-click with
 * an unsteady hand -- which on every page on the web means "open this in a new tab" -- is still a Ctrl-click. Below
 * four, ordinary clicking started being swallowed; above about ten, the gesture felt like it was ignoring you.
 */
export const DRAG_THRESHOLD = 6

/** The smallest selection worth sending anywhere, in CSS pixels. Below this there is nothing in it to look at. */
export const LEAST_SIDE = 24

/**
 * The smallest selection the capture is allowed to be, in image pixels.
 *
 * Separate from `LEAST_SIDE` because they answer different questions: that one is about whether a person meant to
 * select something, and this one is about whether there is enough detail for a model to read. A 24x24 CSS selection
 * on a 2x display is 48x48 image pixels, which is a favicon -- enough to be a deliberate act and not enough to be a
 * sentence.
 */
export const LEAST_IMAGE_SIDE = 48

/** Handles live at the corners, and are grabbed within this many CSS pixels of one. */
export const HANDLE_REACH = 14

export type Corner = 'nw' | 'ne' | 'sw' | 'se'

export const CORNERS: readonly Corner[] = Object.freeze(['nw', 'ne', 'sw', 'se'])

/** How far the pointer moved, as a distance rather than as two numbers. */
export function travelled(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

/** Whether a drag has gone far enough to be a Visual Search. */
export function pastThreshold(from: Point, to: Point): boolean {
  return travelled(from, to) >= DRAG_THRESHOLD
}

/**
 * The rectangle between two points, whichever way round they are.
 *
 * Every one of the four drag directions comes through here, which is why there is no `if` about direction anywhere
 * else: by the time anything sees a rectangle it has a positive width and a top-left corner.
 */
export function rectBetween(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
}

/** A rectangle with its corners the right way round, whatever was done to it. */
export function normalise(rect: Rect): Rect {
  const x = rect.width < 0 ? rect.x + rect.width : rect.x
  const y = rect.height < 0 ? rect.y + rect.height : rect.y
  return { x, y, width: Math.abs(rect.width), height: Math.abs(rect.height) }
}

/**
 * A rectangle pushed and trimmed until it is inside the window.
 *
 * Moved first, then trimmed -- the order matters. Trimming first would shrink a selection that had merely been
 * dragged a little past the edge, so a person who swept to the right-hand edge of the page would find their selection
 * narrower than the one they drew. Moving first keeps the size wherever the size can be kept.
 */
export function clamp(rect: Rect, room: Size): Rect {
  const found = normalise(rect)
  const width = Math.min(found.width, room.width)
  const height = Math.min(found.height, room.height)
  const x = Math.min(Math.max(found.x, 0), Math.max(room.width - width, 0))
  const y = Math.min(Math.max(found.y, 0), Math.max(room.height - height, 0))
  return { x, y, width, height }
}

/** Whether a selection is large enough on screen to have been meant. */
export function bigEnough(rect: Rect): boolean {
  const found = normalise(rect)
  return found.width >= LEAST_SIDE && found.height >= LEAST_SIDE
}

/** Where a corner is, for drawing a handle and for hit-testing one. */
export function cornerAt(rect: Rect, corner: Corner): Point {
  const r = normalise(rect)
  return {
    x: corner === 'nw' || corner === 'sw' ? r.x : r.x + r.width,
    y: corner === 'nw' || corner === 'ne' ? r.y : r.y + r.height
  }
}

/** Which handle, if any, the pointer is on. Nearest wins, so two handles close together are never ambiguous. */
export function handleUnder(rect: Rect, at: Point): Corner | null {
  let best: Corner | null = null
  let bestGap = HANDLE_REACH
  for (const corner of CORNERS) {
    const gap = travelled(cornerAt(rect, corner), at)
    if (gap <= bestGap) {
      bestGap = gap
      best = corner
    }
  }
  return best
}

/** Whether the pointer is inside the selection, which is what makes it draggable rather than the page. */
export function inside(rect: Rect, at: Point): boolean {
  const r = normalise(rect)
  return at.x >= r.x && at.x <= r.x + r.width && at.y >= r.y && at.y <= r.y + r.height
}

/**
 * The rectangle after a corner has been dragged to a point.
 *
 * The opposite corner is the fixed one, so dragging the top-left handle past the bottom-right corner flips the
 * rectangle rather than inverting it -- which is what every drawing program does and what anybody expects.
 */
export function resized(rect: Rect, corner: Corner, to: Point, room: Size): Rect {
  const opposite: Record<Corner, Corner> = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' }
  const fixed = cornerAt(rect, opposite[corner])
  return clamp(rectBetween(fixed, to), room)
}

/** The rectangle after being dragged by `by`, kept inside the window. */
export function moved(rect: Rect, by: Point, room: Size): Rect {
  const r = normalise(rect)
  return clamp({ x: r.x + by.x, y: r.y + by.y, width: r.width, height: r.height }, room)
}

// ---------------------------------------------------------------- CSS pixels to image pixels

export interface Scale {
  /** Image pixels per CSS pixel across. */
  readonly x: number
  /** And down. Kept separate: they have been seen to differ by a rounding error, and halving a crop is worse. */
  readonly y: number
}

/**
 * How many image pixels there are to a CSS pixel, measured rather than assumed.
 *
 * `devicePixelRatio` is not the answer. The capture arrives at the compositor's scale, which is the device ratio
 * combined with the page's zoom and rounded somewhere along the way -- so at 110% zoom on a 1.5x display it is
 * neither 1.5 nor 1.65 but whatever came out, and a crop computed from the wrong one is a crop of the wrong part of
 * the page. Dividing the image that actually arrived by the viewport it was taken of cannot be wrong about this.
 */
export function scaleOf(image: Size, viewport: Size): Scale {
  const x = viewport.width > 0 ? image.width / viewport.width : 1
  const y = viewport.height > 0 ? image.height / viewport.height : 1
  return { x: x > 0 ? x : 1, y: y > 0 ? y : 1 }
}

/**
 * Where to cut the captured image, in its own pixels.
 *
 * `pad` is a margin in CSS pixels taken around the selection *for the model only*. A diagram cropped exactly to its
 * own outline loses the axis labels that say what it is, and a word cropped to the word loses the sentence. It is
 * deliberately small, and the frame on screen is never drawn around the padded rectangle: the person selected what
 * they selected, and showing them a larger box than they drew would be a lie about what was sent.
 */
export function cropFor(selection: Rect, image: Size, viewport: Size, pad = 0): Rect {
  const scale = scaleOf(image, viewport)
  const grown = clamp(
    {
      x: normalise(selection).x - pad,
      y: normalise(selection).y - pad,
      width: normalise(selection).width + pad * 2,
      height: normalise(selection).height + pad * 2
    },
    viewport
  )
  const x = Math.round(grown.x * scale.x)
  const y = Math.round(grown.y * scale.y)
  // Rounded to whole pixels at both edges rather than rounding the width, so the right-hand edge lands where the
  // selection's right-hand edge was instead of drifting by the accumulated error.
  const right = Math.round((grown.x + grown.width) * scale.x)
  const bottom = Math.round((grown.y + grown.height) * scale.y)
  return {
    x: Math.min(Math.max(x, 0), image.width),
    y: Math.min(Math.max(y, 0), image.height),
    width: Math.min(Math.max(right - x, 0), image.width - Math.min(x, image.width)),
    height: Math.min(Math.max(bottom - y, 0), image.height - Math.min(y, image.height))
  }
}

/**
 * How large to send a crop, given what it is.
 *
 * Two pulls in opposite directions. Text needs pixels: shrink a screenshot of 11px body text and the letters stop
 * being letters, and no amount of model cleverness recovers them. Everything else needs fewer: a photograph of a
 * laptop is as identifiable at 900 pixels across as at 3000, and the larger one is a slower request for the same
 * answer.
 *
 * So the long edge is capped, and the cap is higher when the selection is small -- because a small selection that
 * somebody bothered to make is usually text or a detail, and it is the one that must not be softened. A large
 * selection is a scene, and a scene survives being scaled down.
 */
export function sendSize(crop: Size, cap = 1600): Size {
  const longest = Math.max(crop.width, crop.height)
  // A small crop is scaled *up* to no more than double, which is what makes 14-pixel text legible to a reader that
  // expects more of it. Beyond double there is no information left to reveal, only interpolation.
  if (longest > 0 && longest < 320) {
    const grow = Math.min(2, 640 / longest)
    return { width: Math.round(crop.width * grow), height: Math.round(crop.height * grow) }
  }
  if (longest <= cap) return { width: Math.round(crop.width), height: Math.round(crop.height) }
  const shrink = cap / longest
  return { width: Math.max(1, Math.round(crop.width * shrink)), height: Math.max(1, Math.round(crop.height * shrink)) }
}

/** Whether a crop has enough pixels in it to be worth asking about. */
export function enoughPixels(crop: Size): boolean {
  return crop.width >= LEAST_IMAGE_SIDE && crop.height >= LEAST_IMAGE_SIDE
}
