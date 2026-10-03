import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { lastLine, placeOrb, placePanel, selectionBounds, stillVisible, type Rect, type Room } from './selectionPlacement.ts'

const room: Room = { width: 1200, height: 800 }
const size = 18

const inside = (what: { x: number; y: number }, w: number, h: number, r: Room): boolean =>
  what.x >= 0 && what.y >= 0 && what.x + w <= r.width && what.y + h <= r.height

test('the orb sits just after the end of the selected line', () => {
  const line: Rect = { x: 100, y: 300, width: 220, height: 20 }
  const got = placeOrb(line, size, room)
  assert.ok(got.x > line.x + line.width, 'it goes after the words, not on them')
  assert.ok(got.x < line.x + line.width + 20, 'and close to them')
  assert.ok(Math.abs(got.y + size / 2 - (line.y + line.height / 2)) < 2, 'level with the middle of the line')
})

test('a selection ending at the right edge gets the orb underneath instead of off the screen', () => {
  const line: Rect = { x: 1000, y: 300, width: 190, height: 20 }
  const got = placeOrb(line, size, room)
  assert.ok(inside(got, size, size, room), `the orb must stay in the window, got ${JSON.stringify(got)}`)
  assert.ok(got.y > line.y + line.height - 1, 'it dropped below the line')
})

test('a selection at the very bottom still gets an orb that can be clicked', () => {
  const got = placeOrb({ x: 40, y: 788, width: 200, height: 18 }, size, room)
  assert.ok(inside(got, size, size, room), JSON.stringify(got))
})

test('a selection at the very top is not placed under the browser toolbar', () => {
  const tight: Room = { width: 1200, height: 800, inset: { top: 90 } }
  const got = placeOrb({ x: 40, y: 2, width: 200, height: 18 }, size, tight)
  assert.ok(got.y >= 90, `it must clear the browser's own chrome, got y=${got.y}`)
})

test('the panel opens below the selection when there is room', () => {
  const selection: Rect = { x: 100, y: 200, width: 300, height: 20 }
  const anchor: Rect = { x: 406, y: 199, width: size, height: size }
  const got = placePanel(anchor, selection, { width: 280, height: 320 }, room)
  assert.equal(got.from, 'below')
  assert.ok(got.y >= selection.y + selection.height, 'it must not cover the words it is about')
  assert.equal(got.height, 320)
})

test('the panel opens above when the selection is near the bottom', () => {
  const selection: Rect = { x: 100, y: 700, width: 300, height: 20 }
  const anchor: Rect = { x: 406, y: 699, width: size, height: size }
  const got = placePanel(anchor, selection, { width: 280, height: 320 }, room)
  assert.equal(got.from, 'above')
  assert.ok(got.y + got.height <= selection.y, 'it must stop before the selection starts')
  assert.ok(got.y >= 0)
})

test('with room on neither side the panel takes the bigger one and gets shorter', () => {
  const small: Room = { width: 1200, height: 420 }
  const selection: Rect = { x: 100, y: 180, width: 300, height: 20 }
  const anchor: Rect = { x: 406, y: 179, width: size, height: size }
  const got = placePanel(anchor, selection, { width: 280, height: 600 }, small)
  assert.ok(got.height < 600, 'it had to give way')
  assert.ok(got.height >= 120, 'but not so far that it is useless')
  assert.ok(got.y >= 0 && got.y + got.height <= small.height, JSON.stringify(got))
})

test('a selection at the far right gets a panel that slides left rather than off the screen', () => {
  const selection: Rect = { x: 1050, y: 300, width: 140, height: 20 }
  const anchor: Rect = { x: 1174, y: 299, width: size, height: size }
  const got = placePanel(anchor, selection, { width: 280, height: 300 }, room)
  assert.ok(got.x + 280 <= room.width, `the panel ran off the right, x=${got.x}`)
  assert.ok(got.x >= 0)
})

test('the side panel being open is room the panel does not get to use', () => {
  const withSidebar: Room = { width: 1200, height: 800, inset: { right: 360 } }
  const selection: Rect = { x: 700, y: 300, width: 120, height: 20 }
  const anchor: Rect = { x: 826, y: 299, width: size, height: size }
  const got = placePanel(anchor, selection, { width: 280, height: 300 }, withSidebar)
  assert.ok(got.x + 280 <= 1200 - 360, `it must stay clear of the side panel, x=${got.x}`)
})

test('a selection scrolled out of sight is no longer somewhere to point at', () => {
  assert.equal(stillVisible({ x: 10, y: 300, width: 100, height: 20 }, room), true)
  assert.equal(stillVisible({ x: 10, y: -400, width: 100, height: 20 }, room), false, 'scrolled off the top')
  assert.equal(stillVisible({ x: 10, y: 1400, width: 100, height: 20 }, room), false, 'scrolled off the bottom')
  assert.equal(stillVisible({ x: 10, y: 300, width: 0, height: 0 }, room), false, 'collapsed to nothing')
})

test('the whole of a selection covers every line of it', () => {
  const got = selectionBounds([
    { x: 100, y: 200, width: 300, height: 20 },
    { x: 40, y: 220, width: 420, height: 20 },
    { x: 40, y: 240, width: 120, height: 20 }
  ])
  assert.deepEqual(got, { x: 40, y: 200, width: 420, height: 60 })
})

test('empty rectangles are ignored, and nothing at all is nothing', () => {
  assert.deepEqual(selectionBounds([{ x: 0, y: 0, width: 0, height: 0 }]), null)
  assert.equal(selectionBounds([]), null)
  assert.equal(lastLine([]), null)
})

test('the last line of a selection is the one the orb goes beside', () => {
  const got = lastLine([
    { x: 100, y: 200, width: 300, height: 20 },
    { x: 40, y: 220, width: 420, height: 20 },
    { x: 40, y: 240, width: 120, height: 20 }
  ])
  assert.deepEqual(got, { x: 40, y: 240, width: 120, height: 20 }, 'the short last line, not the long middle one')
})
