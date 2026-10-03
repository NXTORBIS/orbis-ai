import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cellAt, layoutIfMoved, nearestSize, orderFromCell, spanFromPixels, stepOrder, stepSize, type GridBox } from './boardMath.ts'
import type { WidgetInstance, WidgetSize } from '../../../src/shared/widgets.ts'

const widget = (id: string, size: WidgetSize, order: number, extra: Partial<WidgetInstance> = {}): WidgetInstance =>
  ({ id, widget: 'clock', zone: 'centre', order, size, settings: {}, collapsed: false, disabled: false, locked: false, hidden: false, look: { tone: 'glass', density: 'comfortable' }, addedAt: order, ...extra }) as WidgetInstance

const box: GridBox = { left: 100, top: 200, cell: 156, gap: 14, columns: 4 }

test('the cell under the pointer, and never one off the grid', () => {
  assert.deepEqual(cellAt(box, 110, 210, 3), { column: 0, row: 0 })
  assert.deepEqual(cellAt(box, 100 + 170, 200 + 170, 3), { column: 1, row: 1 })
  assert.deepEqual(cellAt(box, 5_000, 5_000, 3), { column: 3, row: 2 }, 'far off the right stays in the last column')
  assert.deepEqual(cellAt(box, -500, -500, 3), { column: 0, row: 0 })
})

test('dropping on a widget takes its place', () => {
  const board = [widget('a', 'small', 0), widget('b', 'small', 1), widget('c', 'small', 2)]
  assert.equal(orderFromCell(board, 'c', 0, 0, 4), 0, 'dropped on the first, it becomes the first')
  assert.equal(orderFromCell(board, 'a', 1, 0, 4), 1)
})

test('dropping past the last widget on a row means the end of that row', () => {
  const board = [widget('a', 'small', 0), widget('b', 'small', 1), widget('c', 'small', 2)]
  assert.equal(orderFromCell(board, 'a', 3, 0, 4), 2)
})

test('a widget that is not on the board does not move anything', () => {
  const board = [widget('a', 'small', 0)]
  assert.equal(orderFromCell(board, 'nope', 0, 0, 4), 0)
})

test('hidden widgets have no cells, so a drag cannot reorder them by accident', () => {
  const board = [widget('a', 'small', 0), widget('hidden', 'small', 1, { hidden: true }), widget('c', 'small', 2)]
  // Two cards are drawn; the second cell is "c", not the hidden one.
  assert.equal(orderFromCell(board, 'a', 1, 0, 4), 1)
  const { placed } = layoutIfMoved(board, 'a', 1, 4)
  assert.deepEqual(placed.map((one) => one.id), ['c', 'a'])
})

test('the board laid out as it would be after a move is what the outline is drawn from', () => {
  const board = [widget('a', 'medium', 0), widget('b', 'small', 1), widget('c', 'tall', 2)]
  const { placed, rows } = layoutIfMoved(board, 'c', 0, 4)
  assert.deepEqual(placed.map((one) => one.id), ['c', 'a', 'b'])
  assert.deepEqual(placed[0], { id: 'c', x: 0, y: 0, w: 1, h: 2 })
  assert.deepEqual(placed[1], { id: 'a', x: 1, y: 0, w: 2, h: 1 })
  assert.ok(rows >= 2)
})

test('a move past the end lands at the end rather than failing', () => {
  const board = [widget('a', 'small', 0), widget('b', 'small', 1)]
  const { placed } = layoutIfMoved(board, 'a', 99, 4)
  assert.deepEqual(placed.map((one) => one.id), ['b', 'a'])
})

test('a resize snaps to a size the widget actually offers', () => {
  const sizes: WidgetSize[] = ['small', 'medium', 'large']
  assert.equal(nearestSize(sizes, 1, 1, 4), 'small')
  assert.equal(nearestSize(sizes, 2, 1, 4), 'medium')
  assert.equal(nearestSize(sizes, 2, 2, 4), 'large')
  // Dragged to a shape it does not come in: the closest it does.
  assert.equal(nearestSize(sizes, 1, 2, 4), 'large', 'between two, the one with more room')
  assert.equal(nearestSize(['tall'], 3, 1, 4), 'tall')
  assert.equal(nearestSize([], 1, 1, 4), null)
})

test('a full-row size is as wide as the page has columns', () => {
  assert.equal(nearestSize(['medium', 'wide'], 4, 1, 4), 'wide')
  assert.equal(nearestSize(['medium', 'wide'], 2, 1, 4), 'medium')
  // On a two-column page a full row and medium are the very same shape, and the plainer size is the one chosen.
  assert.equal(nearestSize(['medium', 'wide'], 2, 1, 2), 'medium')
})

test('pixels dragged become whole cells, at least one of each', () => {
  assert.deepEqual(spanFromPixels(box, 156, 156), { across: 1, down: 1 })
  assert.deepEqual(spanFromPixels(box, 326, 156), { across: 2, down: 1 })
  assert.deepEqual(spanFromPixels(box, 10, 10), { across: 1, down: 1 })
  assert.deepEqual(spanFromPixels(box, 9_000, 9_000), { across: 4, down: 53 })
})

test('the keyboard steps through the sizes a widget offers and stops at the ends', () => {
  const sizes: WidgetSize[] = ['small', 'medium', 'large']
  assert.equal(stepSize(sizes, 'small', 1), 'medium')
  assert.equal(stepSize(sizes, 'large', 1), null)
  assert.equal(stepSize(sizes, 'small', -1), null)
  assert.equal(stepSize(sizes, 'wide', 1), 'small', 'a size it no longer offers starts again at the first')
})

test('the keyboard nudges a widget one place and stops at the ends', () => {
  const board = [widget('a', 'small', 0), widget('b', 'small', 1)]
  assert.equal(stepOrder(board, 'a', 1), 1)
  assert.equal(stepOrder(board, 'a', -1), null)
  assert.equal(stepOrder(board, 'b', 1), null)
  assert.equal(stepOrder(board, 'nope', 1), null)
})
