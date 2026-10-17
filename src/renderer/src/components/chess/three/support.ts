/**
 * Whether the 3D board can be shown, and what to say when it cannot.
 *
 * A 3D view is the one part of a chess screen that can simply not be available: a machine with no working graphics
 * driver, a remote session, a browser that has blacklisted the card, or a graphics context that was alive a moment
 * ago and has been lost. None of that is an error anybody did, and none of it is a reason to show a blank
 * rectangle.
 *
 * So the rule here is: the flat board is always the answer, and the 3D board is an extra. Whenever the 3D board
 * cannot be drawn, the flat board is drawn with the same position and the person is told plainly which it is and
 * why, in one sentence, with no code in it.
 */

/** What is wrong, when something is. */
export type Trouble =
  | 'none'
  /** The browser would not give us a graphics context at all. */
  | 'no-webgl'
  /** The graphics code itself could not be loaded. */
  | 'no-library'
  /** A context we had has gone away: the driver reset, or the card was taken by something else. */
  | 'context-lost'
  /** Setting the scene up threw. */
  | 'build-failed'

export type Route = '3d' | 'flat'

export interface Decision {
  route: Route
  /** One sentence for the person, or an empty string when there is nothing to say. */
  message: string
  /** True when trying again could plausibly work, so the control that offers it is not a lie. */
  retryable: boolean
}

/**
 * Which board to show.
 *
 * `wanted` is what the person asked for. Asking for the flat board is not a failure and says nothing; everything
 * else is a 3D board that could not be given.
 */
export function decide(wanted: Route, trouble: Trouble): Decision {
  if (wanted === 'flat') return { route: 'flat', message: '', retryable: false }
  switch (trouble) {
    case 'none':
      return { route: '3d', message: '', retryable: false }
    case 'no-webgl':
      return {
        route: 'flat',
        message: 'This computer cannot draw a 3D view, so the flat board is shown instead. The position is the same.',
        retryable: false
      }
    case 'no-library':
      return {
        route: 'flat',
        message: 'The 3D board could not be loaded, so the flat board is shown instead. The position is the same.',
        retryable: true
      }
    case 'context-lost':
      return {
        route: 'flat',
        message: 'The 3D view was lost, which usually means the graphics driver restarted. The flat board is shown instead, with the position unchanged.',
        retryable: true
      }
    case 'build-failed':
      return {
        route: 'flat',
        message: 'The 3D board could not be set up, so the flat board is shown instead. The position is the same.',
        retryable: true
      }
  }
}

/**
 * Is there any point drawing a frame?
 *
 * Three separate things have to be true, and they fail for different reasons: the canvas has to be somewhere on
 * screen, the window has to be the one being looked at, and something has to have changed since the last frame.
 * A 3D board that kept drawing while the Study tab was in front would cost a laptop its battery for a picture
 * nobody can see.
 */
export function shouldDraw(input: { onScreen: boolean; windowVisible: boolean; changed: boolean; lost: boolean }): boolean {
  if (input.lost) return false
  if (!input.onScreen || !input.windowVisible) return false
  return input.changed
}

/**
 * How long the camera takes to swing back to a named view, in milliseconds.
 *
 * Zero when the person has asked for less movement. There is nothing else moving in this scene -- no spinning, no
 * drifting, no idle animation -- so this one easing is the whole of what the preference applies to, and honouring
 * it means the reset is instant rather than smoothed.
 */
export function resetDuration(reducedMotion: boolean): number {
  return reducedMotion ? 0 : 260
}

/** How far a picked-up piece lifts off its square, and how long it takes to get there. */
export const LIFT_HEIGHT = 0.17

export function liftDuration(reducedMotion: boolean): number {
  return reducedMotion ? 0 : 130
}

/**
 * How many pixels to draw, per page pixel.
 *
 * Capped at two because beyond that nobody can see the difference on a board this size, and the cost of a frame
 * goes up with the square of it. A machine reporting something absurd is clamped rather than believed.
 */
export function drawScale(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1
  return Math.min(2, Math.max(1, devicePixelRatio))
}

/** What the component can tell whoever mounted it, so a runtime check can see the same facts a person would. */
export interface Diagnostic {
  route: Route
  trouble: Trouble
  /** Which graphics interface was given, when one was. */
  api: 'webgl2' | 'webgl' | 'none'
  /** How many things the scene draws, and how many triangles they come to. Counted, not estimated. */
  meshes: number
  triangles: number
  /** How many frames have been drawn since the view opened. A board nobody is looking at should stop adding to it. */
  frames: number
}
