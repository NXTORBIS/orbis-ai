/**
 * What the pieces look like.
 *
 * A 3D chess board is only worth having if you can tell a bishop from a queen at a glance from an angle, so the
 * shapes here are described rather than modelled: each piece is a turned profile -- the outline you would cut on a
 * lathe -- plus a few solid parts for the bits a lathe cannot make, like the knight's head and the king's cross.
 *
 * Two rules decide every number below, and both are checked by the tests:
 *
 * 1. **Height tells you what it is.** The six pieces have six clearly different heights, in a fixed order, so even
 *    from almost overhead, where the outlines foreshorten into nothing, the pieces are still separable.
 * 2. **Nothing leaves its square.** No part is wider than 0.46 across, against a square one unit wide, so two
 *    pieces side by side never touch and the square under a piece is always visible around it.
 *
 * It is all plain data. Nothing here imports three.js: the scene turns these numbers into geometry, and a test can
 * read them without a graphics card.
 */

import type { PieceLetter } from '../../../../../shared/chess/rules.ts'
import type { Orientation } from './boardGeometry.ts'

/** A point on the turned outline: how far out from the middle, and how high up. */
export interface ProfilePoint { r: number; y: number }

/**
 * A solid part bolted onto the turned body.
 *
 * `tone` says which colour it takes. `body` is the piece's own colour. `accent` is a dark grey for the one place a
 * shape alone is not enough -- the slot in a bishop's mitre, which is what tells a bishop from a pawn with
 * ambitions when both are seen from above. `rim` is the collar at the foot of every piece, and it is the one part
 * of the whole board that exists purely so you can see where a piece ends and a square begins.
 */
export type Tone = 'body' | 'accent' | 'rim'

export type Part =
  | { kind: 'sphere'; r: number; at: [number, number, number]; tone?: Tone }
  | { kind: 'box'; size: [number, number, number]; at: [number, number, number]; yaw?: number; pitch?: number; tone?: Tone }
  | { kind: 'cylinder'; rTop: number; rBottom: number; h: number; at: [number, number, number]; pitch?: number; tone?: Tone }
  | { kind: 'torus'; r: number; tube: number; at: [number, number, number]; tone?: Tone }

export interface PieceShape {
  /** The turned outline, bottom to top. Starts and ends at the middle so the solid is closed. */
  profile: ProfilePoint[]
  /** The parts a lathe cannot turn. */
  parts: Part[]
  /** How tall the whole piece is. Kept here as the one number the readability rule is stated in. */
  height: number
  /** Said plainly, for the spoken description of a square. */
  name: string
}

/** The widest any part of any piece may be, against a square one unit across. */
export const MAX_SPAN = 0.46

/** How tall each piece is, in the order that makes them separable by height alone. */
export const PIECE_HEIGHT: Record<PieceLetter, number> = {
  p: 0.52,
  r: 0.60,
  n: 0.70,
  b: 0.80,
  q: 0.90,
  k: 1.02
}

/** Shortest to tallest. The tests check the heights above really are in this order. */
export const HEIGHT_ORDER: PieceLetter[] = ['p', 'r', 'n', 'b', 'q', 'k']

export const PIECE_NAME: Record<PieceLetter, string> = {
  k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn'
}

/** Spreads a part evenly round the middle, for crowns and crenellations. */
function aroundY(count: number, radius: number, make: (x: number, z: number, index: number) => Part): Part[] {
  const out: Part[] = []
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2
    out.push(make(Math.cos(angle) * radius, Math.sin(angle) * radius, i))
  }
  return out
}

/** The base every piece stands on: a flared foot that keeps it from looking like it is floating. */
const foot = (r: number): ProfilePoint[] => [
  { r: 0, y: 0 },
  { r, y: 0 },
  { r, y: 0.030 },
  { r: r - 0.028, y: 0.058 },
  { r: r - 0.060, y: 0.082 }
]

/**
 * The collar at the foot, in a colour chosen to stand against the square the piece is weak on.
 *
 * This is here because of a measurement, not a taste. A white piece against a light square comes out at about 1.6
 * to 1 in flat contrast, and a black piece against a dark square at about 2.6 -- both under the three to one that
 * anything meant to be seen needs. No shade of white can fix it: against these squares even pure white only
 * reaches 1.75, which is a fact about chessboards rather than about this palette.
 *
 * So the separation is drawn rather than hoped for. Every piece wears a band just above its base, and which band
 * depends on the piece's colour: dark under a white piece, light under a black one. `palette.test.ts` checks that
 * every piece has at least three to one against every square, by its body or by its collar.
 *
 * It sits above the flare rather than round it, so it stands proud of the body at that height and is never buried.
 */
const collar = (footRadius: number): Part => ({
  kind: 'cylinder',
  rTop: footRadius - 0.040,
  rBottom: footRadius - 0.040,
  h: 0.020,
  at: [0, 0.092, 0],
  tone: 'rim'
})

const PAWN: PieceShape = {
  height: PIECE_HEIGHT.p,
  name: PIECE_NAME.p,
  profile: [
    ...foot(0.195),
    { r: 0.096, y: 0.120 },
    { r: 0.082, y: 0.200 },
    { r: 0.086, y: 0.236 },
    { r: 0.132, y: 0.262 },
    { r: 0.132, y: 0.284 },
    { r: 0.088, y: 0.306 },
    { r: 0.108, y: 0.340 },
    { r: 0.130, y: 0.390 },
    { r: 0.126, y: 0.444 },
    { r: 0.092, y: 0.488 },
    { r: 0.044, y: 0.514 },
    { r: 0, y: PIECE_HEIGHT.p }
  ],
  parts: [collar(0.195)]
}

const ROOK: PieceShape = {
  height: PIECE_HEIGHT.r,
  name: PIECE_NAME.r,
  profile: [
    ...foot(0.205),
    { r: 0.140, y: 0.112 },
    { r: 0.134, y: 0.330 },
    { r: 0.150, y: 0.368 },
    { r: 0.190, y: 0.400 },
    { r: 0.196, y: 0.470 },
    { r: 0.196, y: 0.500 },
    { r: 0, y: 0.500 }
  ],
  // The battlements. Six of them, which reads as a tower from any angle without needing to be counted.
  parts: [collar(0.205), ...aroundY(6, 0.150, (x, z) => ({
    kind: 'box',
    size: [0.082, 0.100, 0.082],
    at: [x, 0.550, z],
    yaw: Math.atan2(z, x)
  }))]
}

const KNIGHT: PieceShape = {
  height: PIECE_HEIGHT.n,
  name: PIECE_NAME.n,
  profile: [
    ...foot(0.200),
    { r: 0.136, y: 0.110 },
    { r: 0.126, y: 0.180 },
    { r: 0.150, y: 0.214 },
    { r: 0.150, y: 0.240 },
    { r: 0.112, y: 0.268 },
    { r: 0.096, y: 0.300 },
    { r: 0, y: 0.300 }
  ],
  /*
   * A horse's head, built from four solids and facing the far end of the board.
   *
   * It is the only piece that is not the same from every side, and that is the point: a knight you can see is
   * facing somewhere is a knight nobody mistakes for a bishop. The scene turns it to face the opponent, which is
   * why nothing here is rotated about the upright axis.
   */
  parts: [
    collar(0.200),
    // The neck, leaning forward.
    { kind: 'box', size: [0.150, 0.250, 0.130], at: [0, 0.400, -0.020], pitch: -0.26 },
    // The head, carrying on at a different angle.
    { kind: 'box', size: [0.140, 0.120, 0.230], at: [0, 0.590, -0.080], pitch: 0.30 },
    // The muzzle.
    { kind: 'box', size: [0.112, 0.090, 0.110], at: [0, 0.570, -0.185] },
    // One ear, set back, which settles which way it is looking even in silhouette.
    { kind: 'box', size: [0.048, 0.090, 0.052], at: [0.040, 0.672, 0.040], pitch: -0.2 },
    { kind: 'box', size: [0.048, 0.090, 0.052], at: [-0.040, 0.672, 0.040], pitch: -0.2 }
  ]
}

const BISHOP: PieceShape = {
  height: PIECE_HEIGHT.b,
  name: PIECE_NAME.b,
  profile: [
    ...foot(0.198),
    { r: 0.118, y: 0.112 },
    { r: 0.104, y: 0.210 },
    { r: 0.150, y: 0.250 },
    { r: 0.150, y: 0.274 },
    { r: 0.120, y: 0.300 },
    { r: 0.158, y: 0.372 },
    { r: 0.150, y: 0.470 },
    { r: 0.112, y: 0.560 },
    { r: 0.070, y: 0.636 },
    { r: 0.048, y: 0.676 },
    { r: 0, y: 0.692 }
  ],
  parts: [
    collar(0.198),
    // The finial on top of the mitre.
    { kind: 'sphere', r: 0.054, at: [0, 0.730, 0] },
    { kind: 'cylinder', rTop: 0.020, rBottom: 0.020, h: 0.056, at: [0, 0.780, 0] },
    /*
     * The slot in the mitre, in the accent colour.
     *
     * This is the one place where shape alone was not enough. From almost overhead a bishop and a tall pawn are
     * two circles, and the slot is what separates them, so it is drawn in a contrasting grey rather than carved
     * into the body where the shading would lose it.
     */
    { kind: 'box', size: [0.026, 0.230, 0.300], at: [0, 0.520, 0], tone: 'accent' }
  ]
}

const QUEEN: PieceShape = {
  height: PIECE_HEIGHT.q,
  name: PIECE_NAME.q,
  profile: [
    ...foot(0.215),
    { r: 0.132, y: 0.118 },
    { r: 0.112, y: 0.240 },
    { r: 0.166, y: 0.286 },
    { r: 0.166, y: 0.312 },
    { r: 0.126, y: 0.342 },
    { r: 0.150, y: 0.440 },
    { r: 0.168, y: 0.560 },
    { r: 0.150, y: 0.636 },
    { r: 0.182, y: 0.676 },
    { r: 0.182, y: 0.712 },
    { r: 0.148, y: 0.736 },
    { r: 0, y: 0.736 }
  ],
  parts: [
    collar(0.215),
    // A ring of points round the crown, and a bead in the middle: a coronet, which is not a cross.
    ...aroundY(8, 0.150, (x, z) => ({ kind: 'sphere', r: 0.046, at: [x, 0.776, z] })),
    { kind: 'sphere', r: 0.056, at: [0, 0.846, 0] }
  ]
}

const KING: PieceShape = {
  height: PIECE_HEIGHT.k,
  name: PIECE_NAME.k,
  profile: [
    ...foot(0.222),
    { r: 0.140, y: 0.120 },
    { r: 0.118, y: 0.250 },
    { r: 0.172, y: 0.300 },
    { r: 0.172, y: 0.328 },
    { r: 0.132, y: 0.360 },
    { r: 0.156, y: 0.470 },
    { r: 0.176, y: 0.610 },
    { r: 0.158, y: 0.690 },
    { r: 0.190, y: 0.734 },
    { r: 0.190, y: 0.776 },
    { r: 0.150, y: 0.800 },
    { r: 0, y: 0.800 }
  ],
  parts: [
    collar(0.222),
    // The cross. Two bars, which is the one shape nothing else on the board has.
    { kind: 'box', size: [0.062, 0.220, 0.062], at: [0, 0.910, 0] },
    { kind: 'box', size: [0.180, 0.062, 0.062], at: [0, 0.952, 0] }
  ]
}

const SHAPES: Record<PieceLetter, PieceShape> = { p: PAWN, r: ROOK, n: KNIGHT, b: BISHOP, q: QUEEN, k: KING }

export function shapeFor(type: PieceLetter): PieceShape {
  return SHAPES[type]
}

/** Every shape, for a test that wants to check them all. */
export function allShapes(): { type: PieceLetter; shape: PieceShape }[] {
  return HEIGHT_ORDER.map((type) => ({ type, shape: SHAPES[type] }))
}

/** The box a piece really occupies: how far it reaches on each axis from the middle of its square. */
export interface Extent { minX: number; maxX: number; minZ: number; maxZ: number; top: number }

/** Half the width of a tilted box along each axis. A box turned at an angle reaches further than its face does. */
function halfExtents(size: [number, number, number], yaw: number, pitch: number): { x: number; y: number; z: number } {
  const [w, h, d] = [size[0] / 2, size[1] / 2, size[2] / 2]
  // Turning about the upright axis mixes width and depth; tipping forward mixes height and depth.
  const cy = Math.abs(Math.cos(yaw))
  const sy = Math.abs(Math.sin(yaw))
  const cp = Math.abs(Math.cos(pitch))
  const sp = Math.abs(Math.sin(pitch))
  return {
    x: w * cy + d * sy,
    y: h * cp + (d * cy + w * sy) * sp,
    z: (d * cy + w * sy) * cp + h * sp
  }
}

/**
 * The space a piece takes up, measured part by part.
 *
 * Measured per axis rather than as one distance from the middle, because the knight is not the same front to back
 * as it is side to side -- its muzzle sticks out -- and treating it as a circle would say it was too big for its
 * square when it is not.
 */
export function extentOf(shape: PieceShape): Extent {
  let minX = 0
  let maxX = 0
  let minZ = 0
  let maxZ = 0
  let top = 0
  const widen = (cx: number, cz: number, hx: number, hz: number): void => {
    minX = Math.min(minX, cx - hx)
    maxX = Math.max(maxX, cx + hx)
    minZ = Math.min(minZ, cz - hz)
    maxZ = Math.max(maxZ, cz + hz)
  }
  for (const point of shape.profile) {
    widen(0, 0, point.r, point.r)
    top = Math.max(top, point.y)
  }
  for (const part of shape.parts) {
    const [cx, cy, cz] = part.at
    if (part.kind === 'sphere') {
      widen(cx, cz, part.r, part.r)
      top = Math.max(top, cy + part.r)
    } else if (part.kind === 'torus') {
      widen(cx, cz, part.r + part.tube, part.r + part.tube)
      top = Math.max(top, cy + part.tube)
    } else if (part.kind === 'cylinder') {
      const r = Math.max(part.rTop, part.rBottom)
      widen(cx, cz, r, r)
      top = Math.max(top, cy + part.h / 2)
    } else {
      const half = halfExtents(part.size, part.yaw ?? 0, part.pitch ?? 0)
      widen(cx, cz, half.x, half.z)
      top = Math.max(top, cy + half.y)
    }
  }
  return { minX, maxX, minZ, maxZ, top }
}

/** The widest the piece is on either axis, which is what has to fit inside a square. */
export function spanOf(shape: PieceShape): number {
  const box = extentOf(shape)
  return Math.max(box.maxX - box.minX, box.maxZ - box.minZ)
}

/** The tallest point of a piece, counting its solid parts, which is what the declared height has to agree with. */
export function topOf(shape: PieceShape): number {
  return extentOf(shape).top
}

/**
 * How wide the turned body is at a given height.
 *
 * Needed for one check only: a collar that does not stand out past the body at its own height would be swallowed
 * by it, and the piece would quietly lose the thing that separates it from the square it is standing on.
 */
export function profileRadiusAt(shape: PieceShape, y: number): number {
  let widest = 0
  for (let i = 1; i < shape.profile.length; i += 1) {
    const low = shape.profile[i - 1]
    const high = shape.profile[i]
    if (y < low.y || y > high.y) continue
    const span = high.y - low.y
    const across = span <= 0 ? high.r : low.r + ((y - low.y) / span) * (high.r - low.r)
    widest = Math.max(widest, across)
  }
  return widest
}

/**
 * Which way a piece faces.
 *
 * Only the knight shows it, but every piece is turned the same way so the lighting falls on them consistently. A
 * piece faces the far end of the board from its own side's point of view, which depends both on its colour and on
 * which way up the board is being shown.
 */
export function pieceYaw(color: 'w' | 'b', orientation: Orientation): number {
  const facingAway = (color === 'w') === (orientation === 'w')
  return facingAway ? 0 : Math.PI
}

/**
 * Is this set of shapes readable?
 *
 * Returns the reasons it is not, so the test says which piece broke which rule rather than just failing. Kept as a
 * function rather than written out in the test because the rules are a property of the shapes, not of the test.
 */
export function readabilityFaults(): string[] {
  const faults: string[] = []
  for (const { type, shape } of allShapes()) {
    if (shape.profile.length < 6) faults.push(`${type}: too few points to look turned`)
    if (shape.profile[0].r !== 0) faults.push(`${type}: the bottom of the outline is not closed`)
    if (shape.profile[shape.profile.length - 1].r !== 0) faults.push(`${type}: the top of the outline is not closed`)
    for (let i = 1; i < shape.profile.length; i += 1) {
      if (shape.profile[i].y < shape.profile[i - 1].y) faults.push(`${type}: the outline doubles back at point ${i}`)
      if (shape.profile[i].r < 0) faults.push(`${type}: a negative radius at point ${i}`)
    }
    for (const part of shape.parts) {
      /*
       * One turn per part.
       *
       * A part that is both turned and tipped reaches somewhere that depends on which turn happens first, and the
       * answer the measurement above gives would stop matching what the scene draws. No piece needs both, so the
       * rule is simply that none may have both.
       */
      if (part.kind === 'box' && part.yaw && part.pitch) faults.push(`${type}: a part is both turned and tipped`)
    }
    /*
     * The collar has to be there, and it has to be visible.
     *
     * A band buried inside the body would cost a draw call and separate nothing, and nothing on screen would say
     * so -- the piece would simply be harder to see than the measurement promised.
     */
    const rims = shape.parts.filter((part) => part.tone === 'rim')
    if (rims.length !== 1) faults.push(`${type}: has ${rims.length} collars rather than one`)
    for (const rim of rims) {
      if (rim.kind !== 'cylinder') {
        faults.push(`${type}: the collar is a ${rim.kind} rather than a band`)
        continue
      }
      const body = profileRadiusAt(shape, rim.at[1])
      const stands = Math.max(rim.rTop, rim.rBottom) - body
      if (stands < 0.015) {
        faults.push(`${type}: the collar stands only ${stands.toFixed(3)} past the body and would be buried`)
      }
    }
    const span = spanOf(shape)
    if (span > MAX_SPAN) faults.push(`${type}: ${span.toFixed(3)} across, wider than the ${MAX_SPAN} allowed`)
    const top = topOf(shape)
    if (Math.abs(top - shape.height) > 0.025) {
      faults.push(`${type}: declared ${shape.height} tall but reaches ${top.toFixed(3)}`)
    }
  }
  for (let i = 1; i < HEIGHT_ORDER.length; i += 1) {
    const shorter = PIECE_HEIGHT[HEIGHT_ORDER[i - 1]]
    const taller = PIECE_HEIGHT[HEIGHT_ORDER[i]]
    if (taller - shorter < 0.055) {
      faults.push(`${HEIGHT_ORDER[i - 1]} and ${HEIGHT_ORDER[i]} are too close in height to tell apart`)
    }
  }
  return faults
}
