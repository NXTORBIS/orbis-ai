import { packBoard, SIZE_SPAN, visibleWidgets, type PlacedWidget } from '../../../src/shared/widgetBoard.ts'
import type { WidgetInstance, WidgetSize } from '../../../src/shared/widgets.ts'

/**
 * The sums behind moving and resizing a widget with a pointer.
 *
 * Dragging a card is a question about order, not about pixels: the only thing that is ever saved is "this widget is
 * now the third one". So the pointer's position becomes a cell, the cell becomes a place in the order, and the place
 * is laid out by the same `packBoard` the page itself uses -- which is why the outline shown while dragging is
 * exactly where the card will land, rather than a guess that is usually close.
 *
 * Pure: no DOM, no clock.
 */

export interface GridBox {
  /** Where the grid starts on the page, and how big a cell plus its gap is. */
  left: number
  top: number
  cell: number
  gap: number
  columns: number
}

/** The cell the pointer is over, counted from 0 and kept inside the grid. */
export function cellAt(box: GridBox, x: number, y: number, rows: number): { column: number; row: number } {
  const step = box.cell + box.gap
  const column = Math.min(box.columns - 1, Math.max(0, Math.floor((x - box.left) / step)))
  const row = Math.min(Math.max(0, rows - 1), Math.max(0, Math.floor((y - box.top) / step)))
  return { column, row }
}

/**
 * Where a dragged widget would go, as a place in the order of everything on the board.
 *
 * Worked out from what is under the pointer: the widget whose cells the pointer is in gives up its place, and
 * dragging past the last widget means the end. Hidden widgets have no cells and keep the place they had, so a drag
 * never quietly reorders something that is not on the screen.
 */
export function orderFromCell(instances: readonly WidgetInstance[], draggedId: string, column: number, row: number, columns: number): number {
  const shown = visibleWidgets(instances)
  const { placed } = packBoard(shown, columns)
  const from = shown.findIndex((one) => one.id === draggedId)
  if (from < 0) return Math.max(0, shown.length - 1)

  const over = placed.findIndex((one) => column >= one.x && column < one.x + one.w && row >= one.y && row < one.y + one.h)
  if (over >= 0) return over

  // Not over a card: the nearest place on that row, which is what "drop it at the end of this row" means.
  const after = placed.filter((one) => one.y <= row)
  if (after.length === 0) return 0
  const onRow = placed.filter((one) => row >= one.y && row < one.y + one.h)
  if (onRow.length > 0) {
    const last = onRow[onRow.length - 1]
    return column > last.x ? placed.indexOf(last) : placed.indexOf(onRow[0])
  }
  return Math.max(0, shown.length - 1)
}

/** The whole board laid out as it would be if one widget moved to a place: what the outline is drawn from. */
export function layoutIfMoved(instances: readonly WidgetInstance[], id: string, to: number, columns: number): { placed: PlacedWidget[]; rows: number } {
  const shown = visibleWidgets(instances)
  const one = shown.find((other) => other.id === id)
  if (!one) return packBoard(shown, columns)
  const others = shown.filter((other) => other.id !== id)
  const at = Math.min(others.length, Math.max(0, to))
  return packBoard([...others.slice(0, at), one, ...others.slice(at)].map((other, order) => ({ ...other, order })), columns)
}

/**
 * The size a widget becomes when its corner is dragged to about this many cells.
 *
 * Only the sizes that widget actually offers; the nearest by how far off it is across and down, and on a tie the
 * larger one, because a drag outwards that landed between two sizes was asking for more room.
 */
export function nearestSize(sizes: readonly WidgetSize[], across: number, down: number, columns: number): WidgetSize | null {
  if (sizes.length === 0) return null
  let best: { size: WidgetSize; off: number; area: number } | null = null
  for (const size of sizes) {
    const span = SIZE_SPAN[size]
    const w = Math.min(columns, span.w)
    const off = Math.abs(w - across) + Math.abs(span.h - down)
    const area = w * span.h
    if (!best || off < best.off || (off === best.off && area > best.area)) best = { size, off, area }
  }
  return best?.size ?? null
}

/** How many cells across and down a drag of this many pixels is asking for. At least one of each. */
export function spanFromPixels(box: GridBox, width: number, height: number): { across: number; down: number } {
  const step = box.cell + box.gap
  return {
    across: Math.min(box.columns, Math.max(1, Math.round((width + box.gap) / step))),
    down: Math.max(1, Math.round((height + box.gap) / step))
  }
}

/** The next or previous size a widget offers, for the keyboard. Null at either end, so nothing wraps round. */
export function stepSize(sizes: readonly WidgetSize[], current: WidgetSize, by: 1 | -1): WidgetSize | null {
  const at = sizes.indexOf(current)
  if (at < 0) return sizes[0] ?? null
  const next = at + by
  return next >= 0 && next < sizes.length ? sizes[next] : null
}

/** Where a widget goes when it is nudged one place earlier or later. Null when it is already at that end. */
export function stepOrder(instances: readonly WidgetInstance[], id: string, by: 1 | -1): number | null {
  const shown = visibleWidgets(instances)
  const at = shown.findIndex((one) => one.id === id)
  if (at < 0) return null
  const to = at + by
  return to >= 0 && to < shown.length ? to : null
}
