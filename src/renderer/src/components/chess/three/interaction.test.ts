import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLICK_SLOP, beginGesture, endGesture, keyAction, moveGesture, ownsPointer, pointerToNdc, wheelZooms,
  type Gesture, type KeyInput
} from './interaction.ts'

const press = (x = 100, y = 100, button = 0, pointerId = 1): Gesture => {
  const gesture = beginGesture(pointerId, button, x, y)
  assert.ok(gesture, 'the press was not accepted')
  return gesture
}

/** Walks a gesture through a list of positions and says what it ended up being. */
const through = (gesture: Gesture, points: [number, number][]): { end: ReturnType<typeof endGesture>; turned: number } => {
  let current = gesture
  let turned = 0
  for (const [x, y] of points) {
    const moved = moveGesture(current, x, y)
    current = moved.gesture
    turned += Math.abs(moved.dx) + Math.abs(moved.dy)
  }
  return { end: endGesture(current), turned }
}

test('a press that does not move is a click', () => {
  assert.equal(endGesture(press()), 'click')
  assert.equal(through(press(), []).end, 'click')
  assert.equal(through(press(), [[100, 100]]).end, 'click')
})

test('a hand that wobbles inside the slop is still a click, and moves the camera not at all', () => {
  const result = through(press(100, 100), [[101, 100], [102, 101], [100, 102], [100, 100]])
  assert.equal(result.end, 'click')
  assert.equal(result.turned, 0, 'a wobble nudged the camera')
})

test('once a press has travelled far enough it is a look, and it can never go back', () => {
  /*
   * This is the rule the whole thing rests on. The same button turns the camera and picks a piece up, so if a drag
   * that came back to where it started counted as a click, turning the board could play a move -- which is the one
   * way an interface like this could lose somebody a game.
   */
  const far = CLICK_SLOP + 20
  const result = through(press(100, 100), [[100 + far, 100], [100, 100]])
  assert.equal(result.end, 'look', 'a drag that came home was read as a click')
  assert.ok(result.turned > 0, 'a drag did not turn the camera')
  // Diagonally, too: the slop is a distance, not a pair of distances.
  const diagonal = Math.ceil(CLICK_SLOP / Math.SQRT2) + 1
  assert.equal(through(press(), [[100 + diagonal, 100 + diagonal]]).end, 'look')
})

test('the slop is where it says it is, to the pixel', () => {
  // Exactly on the line is still a click; one past it is not.
  assert.equal(through(press(100, 100), [[100 + CLICK_SLOP, 100]]).end, 'click')
  assert.equal(through(press(100, 100), [[100 + CLICK_SLOP + 0.001, 100]]).end, 'look')
})

test('the right button looks and never plays', () => {
  assert.equal(endGesture(press(100, 100, 2)), 'none', 'the right button played something')
  assert.equal(through(press(100, 100, 2), [[200, 200]]).end, 'look')
  // And it does turn the camera, which is what it is for.
  assert.ok(through(press(100, 100, 2), [[200, 200]]).turned > 0)
})

test('the middle button is left to the browser', () => {
  assert.equal(beginGesture(1, 1, 10, 10), null)
  assert.equal(beginGesture(1, 3, 10, 10), null)
  assert.equal(beginGesture(1, 4, 10, 10), null)
  assert.equal(beginGesture(1, 0, Number.NaN, 10), null)
})

test('a second finger cannot steer the gesture the first one started', () => {
  const gesture = press(100, 100, 0, 7)
  assert.ok(ownsPointer(gesture, 7))
  assert.equal(ownsPointer(gesture, 8), false)
  assert.equal(ownsPointer(null, 7), false)
})

test('nonsense from the pointer moves nothing', () => {
  const gesture = press(100, 100)
  const moved = moveGesture(gesture, Number.NaN, 120)
  assert.equal(moved.dx, 0)
  assert.equal(moved.dy, 0)
  assert.equal(moved.gesture, gesture, 'a bad position was recorded anyway')
  assert.equal(endGesture(moved.gesture), 'click')
})

test('after a drag starts, the camera turns by the step and not by the whole travel twice', () => {
  let gesture = press(100, 100)
  const first = moveGesture(gesture, 140, 100)
  gesture = first.gesture
  const second = moveGesture(gesture, 150, 100)
  assert.equal(second.dx, 10, 'the second step was not the step since the last position')
  assert.equal(second.dy, 0)
})

test('the wheel zooms only where it will not take the page\'s scrolling away', () => {
  const plain = { focused: false, shiftKey: false, ctrlKey: false, metaKey: false }
  // Not clicked into, no Shift: the screen scrolls, as it should.
  assert.equal(wheelZooms(plain), false)
  // Clicked into: it is the board's wheel now.
  assert.equal(wheelZooms({ ...plain, focused: true }), true)
  // Shift anywhere: browsers spend that on sideways scrolling, which does nothing here.
  assert.equal(wheelZooms({ ...plain, shiftKey: true }), true)
  // Ctrl and Cmd belong to the browser's own zoom and the system's. Taking those would be rude.
  assert.equal(wheelZooms({ ...plain, focused: true, ctrlKey: true }), false)
  assert.equal(wheelZooms({ ...plain, focused: true, metaKey: true }), false)
  assert.equal(wheelZooms({ ...plain, shiftKey: true, ctrlKey: true }), false)
})

const key = (over: Partial<KeyInput>): KeyInput =>
  ({ key: 'a', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...over })

test('the application keeps every shortcut it had', () => {
  /*
   * A board with focus that swallowed Ctrl+K would break the command palette from inside a chess game, and nothing
   * would report it. So anything held with Ctrl, Cmd or Alt is passed straight through, untouched, whatever it is.
   */
  for (const held of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    for (const character of ['k', 'K', 'ArrowLeft', 'Enter', '0', '[', ' ', 'Escape']) {
      assert.deepEqual(
        keyAction(key({ key: character, ...held })), { kind: 'pass' },
        `${character} with ${Object.keys(held)[0]} was taken by the board`
      )
    }
  }
})

test('the arrows walk the squares, exactly as they do on the flat board', () => {
  assert.deepEqual(keyAction(key({ key: 'ArrowRight' })), { kind: 'walk', dFile: 1, dRank: 0 })
  assert.deepEqual(keyAction(key({ key: 'ArrowLeft' })), { kind: 'walk', dFile: -1, dRank: 0 })
  assert.deepEqual(keyAction(key({ key: 'ArrowUp' })), { kind: 'walk', dFile: 0, dRank: 1 })
  assert.deepEqual(keyAction(key({ key: 'ArrowDown' })), { kind: 'walk', dFile: 0, dRank: -1 })
  assert.deepEqual(keyAction(key({ key: 'Enter' })), { kind: 'take' })
  assert.deepEqual(keyAction(key({ key: ' ' })), { kind: 'take' })
  assert.deepEqual(keyAction(key({ key: 'Escape' })), { kind: 'release' })
})

test('Shift with the arrows turns the camera instead', () => {
  assert.deepEqual(keyAction(key({ key: 'ArrowRight', shiftKey: true })), { kind: 'turn', across: 1, up: 0 })
  assert.deepEqual(keyAction(key({ key: 'ArrowUp', shiftKey: true })), { kind: 'turn', across: 0, up: 1 })
  assert.deepEqual(keyAction(key({ key: 'ArrowDown', shiftKey: true })), { kind: 'turn', across: 0, up: -1 })
  assert.deepEqual(keyAction(key({ key: 'ArrowLeft', shiftKey: true })), { kind: 'turn', across: -1, up: 0 })
})

test('the camera keys are ones nothing else in Orbis uses', () => {
  assert.deepEqual(keyAction(key({ key: ']' })), { kind: 'zoom', steps: -1 })
  assert.deepEqual(keyAction(key({ key: '[' })), { kind: 'zoom', steps: 1 })
  assert.deepEqual(keyAction(key({ key: '+' })), { kind: 'zoom', steps: -1 })
  assert.deepEqual(keyAction(key({ key: '-' })), { kind: 'zoom', steps: 1 })
  assert.deepEqual(keyAction(key({ key: '0' })), { kind: 'view', preset: 'default' })
  assert.deepEqual(keyAction(key({ key: '1' })), { kind: 'view', preset: 'overhead' })
  assert.deepEqual(keyAction(key({ key: '2' })), { kind: 'view', preset: 'side' })
  // Everything else is somebody else's.
  for (const character of ['a', 'Z', 'Tab', 'F5', '3', '9', '/', 'Home', 'PageDown']) {
    assert.deepEqual(keyAction(key({ key: character })), { kind: 'pass' }, `${character} was taken`)
  }
})

test('the pointer becomes the two numbers a camera wants, the right way up', () => {
  const box = { left: 100, top: 50, width: 400, height: 400 }
  // The middle of the picture is the middle of both ranges.
  assert.deepEqual(pointerToNdc(300, 250, box), { x: 0, y: 0 })
  // The top-left corner. Up is positive for a camera and down is positive for a browser, which is the trap.
  assert.deepEqual(pointerToNdc(100, 50, box), { x: -1, y: 1 })
  assert.deepEqual(pointerToNdc(500, 450, box), { x: 1, y: -1 })
  // A box with no size has no answer rather than a divide by nothing.
  assert.equal(pointerToNdc(0, 0, { left: 0, top: 0, width: 0, height: 10 }), null)
  assert.equal(pointerToNdc(0, 0, { left: 0, top: 0, width: 10, height: 0 }), null)
  assert.equal(pointerToNdc(Number.NaN, 0, box), null)
})
