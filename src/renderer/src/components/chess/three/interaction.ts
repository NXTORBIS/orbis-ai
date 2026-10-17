/**
 * Telling a look from a click.
 *
 * On a flat board a click is a click. On a 3D board the same button both turns the camera and picks up a piece, and
 * the difference is only how far the pointer travelled -- which means the one way to lose a game to the interface
 * is for a drag that was meant to turn the board to be read as a move.
 *
 * So the decision is a small state machine with one rule: once the pointer has moved further than a few pixels, the
 * gesture is a look, and it stays a look until the button comes up. It can never go back to being a click. That is
 * why this is a separate file with its own tests rather than a couple of `if`s inside the component.
 *
 * Nothing here touches the browser. The component hands it numbers out of the pointer events.
 */

/** How far the pointer may travel and still count as a click. Four pixels, which a steady hand never exceeds. */
export const CLICK_SLOP = 4

/** A gesture that has not finished yet. */
export interface Gesture {
  /** The pointer this gesture belongs to, so a second finger or a second mouse cannot steer it. */
  pointerId: number
  /** Which button started it. Only the primary button can ever become a click. */
  button: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  /** Set the moment the pointer goes past the slop, and never cleared. */
  dragged: boolean
}

export type GestureEnd = 'click' | 'look' | 'none'

/** A press. Returns the gesture to hold on to, or null when this press is not one we handle. */
export function beginGesture(pointerId: number, button: number, x: number, y: number): Gesture | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  // The middle and right buttons belong to the browser and the app; we never take them.
  if (button !== 0 && button !== 2) return null
  return { pointerId, button, startX: x, startY: y, lastX: x, lastY: y, dragged: false }
}

export interface GestureMove {
  gesture: Gesture
  /** How far to turn the camera this frame, in pixels. Zero until the gesture is a look. */
  dx: number
  dy: number
}

/**
 * The pointer moved.
 *
 * Until the gesture has been promoted to a look, the movement is reported as nothing: a hand that wobbles two
 * pixels on the way to a click should not nudge the camera either.
 */
export function moveGesture(gesture: Gesture, x: number, y: number): GestureMove {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { gesture, dx: 0, dy: 0 }
  const travelled = Math.hypot(x - gesture.startX, y - gesture.startY)
  const dragged = gesture.dragged || travelled > CLICK_SLOP
  const next: Gesture = { ...gesture, lastX: x, lastY: y, dragged }
  if (!dragged) return { gesture: next, dx: 0, dy: 0 }
  // Only the step since the last position. The few pixels that proved it was a drag are spent on proving it.
  return { gesture: next, dx: x - gesture.lastX, dy: y - gesture.lastY }
}

/**
 * The button came up. What was that?
 *
 * A primary-button press that never moved is a click on a square. Anything that moved is a look and plays nothing.
 * The right button is for looking only, so it is never a click however still it was held.
 */
export function endGesture(gesture: Gesture): GestureEnd {
  if (gesture.dragged) return 'look'
  if (gesture.button !== 0) return 'none'
  return 'click'
}

/** Does this pointer event belong to the gesture in progress? A second finger is ignored rather than fought over. */
export function ownsPointer(gesture: Gesture | null, pointerId: number): boolean {
  return gesture !== null && gesture.pointerId === pointerId
}

/**
 * Should the wheel zoom, or should the page scroll?
 *
 * The chess screen scrolls, and the board sits inside the part that scrolls, so a wheel that always zoomed would
 * trap the scroll wheel over a large part of the screen. The rule: the wheel zooms when the board has been clicked
 * into -- it has keyboard focus -- and always zooms when Shift is held, which browsers otherwise spend on sideways
 * scrolling that does nothing here. Otherwise the wheel is left alone and the screen scrolls as it should.
 */
export function wheelZooms(input: { focused: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
  // Ctrl and Cmd with the wheel are the browser's and the system's own zoom. Taking those would be rude.
  if (input.ctrlKey || input.metaKey) return false
  return input.focused || input.shiftKey
}

/**
 * What a key press means here.
 *
 * Three jobs share one keyboard, and they are kept apart on purpose:
 *
 * - **The board** keeps the keys the flat board already uses, so the two feel like one board: the arrows walk the
 *   squares, Enter and Space pick up and put down, Escape lets go.
 * - **The camera** gets the arrows with Shift held, plus `[` and `]` to zoom and `0`, `1` and `2` for the named
 *   views. None of those is a shortcut anywhere else in Orbis.
 * - **The app** keeps everything with Ctrl, Cmd or Alt held. Those are passed straight through untouched, so the
 *   command palette and the rest of the application still work while the board has focus.
 */
export type KeyAction =
  | { kind: 'pass' }
  | { kind: 'walk'; dFile: number; dRank: number }
  | { kind: 'take' }
  | { kind: 'release' }
  | { kind: 'turn'; across: number; up: number }
  | { kind: 'zoom'; steps: number }
  | { kind: 'view'; preset: 'default' | 'overhead' | 'side' }

export interface KeyInput { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }

export function keyAction(input: KeyInput): KeyAction {
  // Anything the application might want keeps going.
  if (input.ctrlKey || input.metaKey || input.altKey) return { kind: 'pass' }
  const arrow: Record<string, [number, number]> = {
    ArrowRight: [1, 0],
    ArrowLeft: [-1, 0],
    ArrowUp: [0, 1],
    ArrowDown: [0, -1]
  }
  const step = arrow[input.key]
  if (step) {
    const [across, up] = step
    // Shift turns the camera; without it the arrows walk the squares, exactly as on the flat board.
    if (input.shiftKey) return { kind: 'turn', across, up }
    return { kind: 'walk', dFile: across, dRank: up }
  }
  if (input.key === 'Enter' || input.key === ' ') return { kind: 'take' }
  if (input.key === 'Escape') return { kind: 'release' }
  if (input.key === ']' || input.key === '+' || input.key === '=') return { kind: 'zoom', steps: -1 }
  if (input.key === '[' || input.key === '-' || input.key === '_') return { kind: 'zoom', steps: 1 }
  if (input.key === '0') return { kind: 'view', preset: 'default' }
  if (input.key === '1') return { kind: 'view', preset: 'overhead' }
  if (input.key === '2') return { kind: 'view', preset: 'side' }
  return { kind: 'pass' }
}

/**
 * Where the pointer is, as the two numbers a camera needs.
 *
 * The middle of the picture is zero and the edges are one, with up being positive -- which is upside down from how
 * a browser reports a pointer, and getting it the wrong way round is the classic way to end up picking the square
 * mirrored about the middle rank.
 */
export function pointerToNdc(
  clientX: number, clientY: number,
  box: { left: number; top: number; width: number; height: number }
): { x: number; y: number } | null {
  if (box.width <= 0 || box.height <= 0) return null
  const x = ((clientX - box.left) / box.width) * 2 - 1
  const y = -(((clientY - box.top) / box.height) * 2 - 1)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  // Adding nothing turns a negative zero back into a zero, so the middle of the picture is one value and not two.
  return { x: x + 0, y: y + 0 }
}
