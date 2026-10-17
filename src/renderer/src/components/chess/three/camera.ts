/**
 * Where you are looking from.
 *
 * The camera orbits the middle of the board. Three numbers say where it is: how far round, how high up, and how far
 * away. Keeping it to three numbers rather than a position means the view can be nudged, clamped and reset without
 * ever ending up somewhere useless -- under the board, exactly overhead where it would flip, or so close that the
 * board fills nothing.
 *
 * No three.js here either. The position is worked out with sine and cosine, so the clamps and the reset can be
 * tested without a graphics card, and the component only has to copy three numbers into the camera it owns.
 */

import type { Vec3 } from './boardGeometry.ts'

export interface View {
  /** How far round the board, in radians. 0 looks along +z, which is from behind the near edge. */
  azimuth: number
  /** The angle down from straight up, in radians. Small is nearly overhead; large is nearly level. */
  polar: number
  /** How far the camera is from what it is looking at. */
  distance: number
}

/** What the camera looks at: the middle of the board, lifted a little so the pieces sit in the frame. */
export const TARGET: Vec3 = { x: 0, y: 0.3, z: 0 }

/**
 * How high and how low the camera may go.
 *
 * The low number keeps it off the pole: looking exactly straight down, "which way is up" has no answer and the
 * view flips as you cross it. The high number keeps it above the board, which matters for more than looks -- the
 * pointer finds a square by following a line down to the surface, and a camera level with the board sends that
 * line sideways, so clicking would stop working before the board looked wrong.
 */
export const POLAR_MIN = 0.1
export const POLAR_MAX = 1.36
export const DISTANCE_MIN = 6.5
export const DISTANCE_MAX = 22

/** How far a drag turns the view: radians per pixel. */
export const DRAG_RATE = 0.0072
/** One notch of the wheel, or one press of a zoom key, multiplies the distance by this. */
export const ZOOM_STEP = 1.12
/** One press of a rotate key, in radians. */
export const KEY_TURN = 0.12

/** Where the camera starts: raked over at about fifty degrees, far enough back to hold the whole board. */
const DEFAULT_POLAR = 0.86
const DEFAULT_DISTANCE = 12.2

/** Keeps a number inside a range. */
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

/** Brings an angle into (-pi, pi], so turning right round comes back to where it started. */
export function wrapAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0
  const full = Math.PI * 2
  let out = angle % full
  if (out > Math.PI) out -= full
  if (out <= -Math.PI) out += full
  return out
}

/** A view that is inside every limit. Anything not a number falls back to the default rather than poisoning the scene. */
export function clampView(view: View): View {
  return {
    azimuth: wrapAngle(view.azimuth),
    polar: clamp(Number.isFinite(view.polar) ? view.polar : DEFAULT_POLAR, POLAR_MIN, POLAR_MAX),
    distance: clamp(Number.isFinite(view.distance) ? view.distance : DEFAULT_DISTANCE, DISTANCE_MIN, DISTANCE_MAX)
  }
}

/**
 * The view you start with, and the one the reset control goes back to.
 *
 * It sits behind whichever side is at the bottom of the board, raked over at about fifty degrees: far enough over
 * to see that the pieces have shape, flat enough that the back rank is not hidden behind the front one.
 */
export function defaultView(): View {
  return { azimuth: 0, polar: DEFAULT_POLAR, distance: DEFAULT_DISTANCE }
}

/** Looking straight down the board from above. Offered as a named view because it is the one that reads like a diagram. */
export function overheadView(): View {
  return { azimuth: 0, polar: POLAR_MIN, distance: 11 }
}

/** Low and over to the side, which is the view that shows height differences between the pieces best. */
export function sideView(): View {
  return { azimuth: -Math.PI / 2, polar: POLAR_MAX - 0.06, distance: 13 }
}

export type ViewPreset = 'default' | 'overhead' | 'side'

export function presetView(preset: ViewPreset): View {
  if (preset === 'overhead') return overheadView()
  if (preset === 'side') return sideView()
  return defaultView()
}

/** Dragging the pointer: across turns the board, up and down raises and lowers the camera. */
export function rotateByDrag(view: View, dx: number, dy: number): View {
  return clampView({
    azimuth: view.azimuth - dx * DRAG_RATE,
    polar: view.polar - dy * DRAG_RATE,
    distance: view.distance
  })
}

/** Turning with the keyboard, in whole steps so repeated presses land on predictable places. */
export function rotateBySteps(view: View, acrossSteps: number, upSteps: number): View {
  return clampView({
    azimuth: view.azimuth - acrossSteps * KEY_TURN,
    polar: view.polar - upSteps * KEY_TURN,
    distance: view.distance
  })
}

/** Zooming. Positive steps move away, negative steps move closer, and each step is the same proportion. */
export function zoomBySteps(view: View, steps: number): View {
  const factor = Math.pow(ZOOM_STEP, Number.isFinite(steps) ? steps : 0)
  return clampView({ azimuth: view.azimuth, polar: view.polar, distance: view.distance * factor })
}

/**
 * A wheel turn as whole zoom steps.
 *
 * Browsers report wheels in pixels, lines or pages depending on the device, and a trackpad sends a stream of tiny
 * pixel deltas where a mouse sends one big one. Dividing by a constant and keeping the sign gives the same feel
 * from both without pretending to know which device it was.
 */
export function wheelSteps(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0
  const perStep = deltaMode === 0 ? 100 : deltaMode === 1 ? 3 : 1
  const steps = deltaY / perStep
  // Never swallow a small turn entirely: a trackpad flick would otherwise do nothing at all.
  if (Math.abs(steps) < 0.25) return Math.sign(steps) * 0.25
  return clamp(steps, -3, 3)
}

/** Where the camera is, given the view. */
export function cameraPosition(view: View, target: Vec3 = TARGET): Vec3 {
  const safe = clampView(view)
  const sin = Math.sin(safe.polar)
  return {
    x: target.x + safe.distance * sin * Math.sin(safe.azimuth),
    y: target.y + safe.distance * Math.cos(safe.polar),
    z: target.z + safe.distance * sin * Math.cos(safe.azimuth)
  }
}

/** Is this view one the pointer can still pick squares from? True whenever the camera is above the surface. */
export function canPick(view: View, target: Vec3 = TARGET): boolean {
  return cameraPosition(view, target).y > 0.05
}

/** Are two views the same, to within what anybody could see? Used to avoid drawing a frame that would not change. */
export function sameView(a: View, b: View): boolean {
  return Math.abs(wrapAngle(a.azimuth - b.azimuth)) < 1e-4
    && Math.abs(a.polar - b.polar) < 1e-4
    && Math.abs(a.distance - b.distance) < 1e-4
}

/**
 * Part of the way from one view to another.
 *
 * Only used so the reset control does not teleport. Turning takes the short way round, so resetting from just past
 * half a turn swings the near way rather than the whole way back.
 */
export function blendViews(from: View, to: View, amount: number): View {
  const t = clamp(Number.isFinite(amount) ? amount : 1, 0, 1)
  const turn = wrapAngle(to.azimuth - from.azimuth)
  return clampView({
    azimuth: from.azimuth + turn * t,
    polar: from.polar + (to.polar - from.polar) * t,
    distance: from.distance + (to.distance - from.distance) * t
  })
}

/** Smooths the start and end of the reset so it does not jolt. Plain arithmetic, so it is the same on every machine. */
export function easeInOut(t: number): number {
  const x = clamp(Number.isFinite(t) ? t : 1, 0, 1)
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
}
