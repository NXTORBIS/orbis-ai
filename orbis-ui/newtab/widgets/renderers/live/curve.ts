/**
 * The sums behind every line these widgets draw: a run of numbers turned into points in a box, and those points
 * turned into a path.
 *
 * Kept apart from the drawing because this is the half that can be wrong without looking wrong. A run that is all
 * the same number collapses onto the floor of its box unless something decides where a flat line belongs. A run
 * with one unreadable number in it quietly bends towards zero unless something refuses the whole run. Both of those
 * decisions are made here, where they can be checked without a page.
 *
 * Pure: no DOM, no clock.
 */

export interface CurveBox {
  width: number
  height: number
  /** Room kept inside the box, so a mark sitting on the highest point is not cut in half by the edge. */
  pad: number
  /**
   * Room at the two ends, when it is not the same as at the top and bottom.
   *
   * A line drawn beside a row of labels has to meet them: an hour's dot belongs over its own hour, not at the very
   * edge of the box with the hour written half an inch away.
   */
  padX?: number
}

export interface CurvePoint {
  x: number
  y: number
  /** The number this point came from, for the label beside it and for the line read aloud. */
  value: number
}

/** Two places is as fine as a screen can draw, and it keeps a path short enough to read. */
const round = (n: number): number => Math.round(n * 100) / 100

/**
 * Where each number sits in the box: left to right in the order given, high numbers near the top.
 *
 * Nothing is drawn from fewer than two numbers, and nothing at all is drawn from a run holding anything that is not
 * a number -- a price that could not be read is not a price of zero, and a line claiming it was would be a lie told
 * in a picture. A run that is all one number is drawn flat through the middle, because that is what it is.
 */
export function curvePoints(values: readonly number[], box: CurveBox): CurvePoint[] {
  if (values.length < 2 || !values.every((one) => Number.isFinite(one))) return []
  const pad = Math.max(0, box.pad)
  const padX = Math.max(0, box.padX ?? pad)
  const left = padX
  const right = Math.max(left, box.width - padX)
  const top = pad
  const bottom = Math.max(top, box.height - pad)
  const low = Math.min(...values)
  const high = Math.max(...values)
  const span = high - low
  const middle = (top + bottom) / 2
  return values.map((value, at) => ({
    x: round(left + ((right - left) * at) / (values.length - 1)),
    y: round(span === 0 ? middle : bottom - ((value - low) / span) * (bottom - top)),
    value
  }))
}

/** A straight path through the points. */
export function linePath(points: readonly CurvePoint[]): string {
  if (points.length === 0) return ''
  return points.map((one, at) => `${at === 0 ? 'M' : 'L'}${one.x} ${one.y}`).join(' ')
}

/**
 * A softened path through the points, bending but never leaving the box.
 *
 * Each control point reaches a sixth of the way towards the neighbour on the far side, which takes the corners off
 * a day of prices without inventing a peak between two readings. They are held inside the box as well: a curve that
 * overshoots the top of its own box is drawn clipped, and a clipped curve reads as a line that was cut off.
 */
export function smoothPath(points: readonly CurvePoint[], box: CurveBox): string {
  if (points.length === 0) return ''
  if (points.length < 3) return linePath(points)
  const hold = (y: number): number => round(Math.min(box.height, Math.max(0, y)))
  const parts = [`M${points[0].x} ${points[0].y}`]
  for (let at = 0; at < points.length - 1; at += 1) {
    const before = points[at - 1] ?? points[at]
    const from = points[at]
    const to = points[at + 1]
    const after = points[at + 2] ?? to
    const c1x = round(from.x + (to.x - before.x) / 6)
    const c1y = hold(from.y + (to.y - before.y) / 6)
    const c2x = round(to.x - (after.x - from.x) / 6)
    const c2y = hold(to.y - (after.y - from.y) / 6)
    parts.push(`C${c1x} ${c1y} ${c2x} ${c2y} ${to.x} ${to.y}`)
  }
  return parts.join(' ')
}

/** The same shape taken down to a floor and closed, for the wash of colour under a line. */
export function areaPath(line: string, points: readonly CurvePoint[], floor: number): string {
  if (line === '' || points.length === 0) return ''
  const first = points[0]
  const last = points[points.length - 1]
  return `${line} L${last.x} ${round(floor)} L${first.x} ${round(floor)} Z`
}

/** The highest and the lowest point. The first of equals, so a flat run marks where it started. */
export function highLow(points: readonly CurvePoint[]): { high: CurvePoint; low: CurvePoint } | null {
  if (points.length === 0) return null
  let high = points[0]
  let low = points[0]
  for (const one of points) {
    if (one.value > high.value) high = one
    if (one.value < low.value) low = one
  }
  return { high, low }
}
