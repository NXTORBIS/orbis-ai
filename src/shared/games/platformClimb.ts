/**
 * Up and Up: the ledges, and the proof that the next one can always be reached from the one below it.
 *
 * The bounce is the same height every time -- you cannot jump higher by pressing anything -- so a climb is a test of
 * aim rather than of timing, and how far you can get from a ledge is arithmetic rather than opinion. That is what makes
 * this testable: `reach(dy)` is how far sideways you can travel while rising `dy`, and nothing is generated that asks
 * for more than that.
 *
 * It is worked out at the worst moment on purpose. A ledge that slides takes the whole of its travel into account, from
 * both ends, so a jump that is possible is possible whenever you take it -- not only when the ledges happen to line up.
 */

import { range, seeded } from './random.ts'

/** The climb is played in a fixed-width world and drawn to fit, so a wide window does not make the game easier. */
export const WIDTH = 420
export const LEDGE_W = 76
export const LEDGE_H = 12
export const PLAYER_W = 30
export const GRAVITY = 1800
/** The one and only bounce. */
export const JUMP_V = 760
export const SPRING_V = 1280
export const MAX_VX = 330
/** How much the air slows a sideways push, so a tap is not a slide. */
export const AIR_DRAG = 6

export type LedgeKind = 'solid' | 'moving' | 'crumble' | 'spring'
export type Difficulty = 'easy' | 'normal' | 'hard'

export interface Ledge {
  /** Height above the start. Up is more. */
  y: number
  /** Where the left end sits when it is at rest. */
  x: number
  kind: LedgeKind
  /** A sliding ledge's travel, in pixels to the right of `x`. Zero for everything else. */
  span: number
  /** Seconds for one slide out and back. */
  period: number
  /** A crumbling ledge that has been bounced on is gone. */
  gone?: boolean
}

/** The highest a bounce reaches: everything about the shape of the climb comes from this one number. */
export const maxRise = (jump = JUMP_V): number => (jump * jump) / (2 * GRAVITY)

/**
 * How far sideways you can travel while climbing `dy`, measured to the later of the two moments the bounce passes that
 * height -- the one on the way down, because landing on the way down is a landing too. Five sixths of it, because
 * nobody flies a parabola perfectly.
 */
export function reach(dy: number, jump = JUMP_V): number {
  const inside = jump * jump - 2 * GRAVITY * dy
  if (inside < 0) return 0
  const seconds = (jump + Math.sqrt(inside)) / GRAVITY
  return MAX_VX * seconds * 0.85
}

/** Where a sliding ledge's left end is at a given moment. It slides out and back at a steady speed. */
export function ledgeX(ledge: Ledge, seconds: number): number {
  if (!ledge.span || !ledge.period) return ledge.x
  const through = (seconds % ledge.period) / ledge.period
  const out = through < 0.5 ? through * 2 : (1 - through) * 2
  return ledge.x + ledge.span * out
}

/** Every left-hand position a ledge can be in: a still ledge is one point, a sliding one is its whole travel. */
const spread = (ledge: Ledge): [number, number] => [ledge.x, ledge.x + ledge.span]

const wrapped = (distance: number): number => Math.min(Math.abs(distance), WIDTH - Math.abs(distance))

/**
 * Whether the jump from one ledge to the next can always be made -- at the worst moment, from the worst place to stand,
 * to the furthest the target can have slid. Going off one side and coming back on the other counts, because that is
 * what the climber really does.
 */
export function reachable(from: Ledge, to: Ledge, jump = JUMP_V): boolean {
  const dy = to.y - from.y
  if (dy <= 0) return true
  if (dy > maxRise(jump)) return false
  const [fromLow, fromHigh] = spread(from)
  const [toLow, toHigh] = spread(to)
  // The worst pairing of the two: standing at one end, landing at the other.
  const worst = Math.max(wrapped(toLow - fromLow), wrapped(toLow - fromHigh), wrapped(toHigh - fromLow), wrapped(toHigh - fromHigh))
  return worst <= reach(dy, jump)
}

interface Shape {
  gap: [number, number]
  span: [number, number]
  /** Out of a hundred ledges, how many are of each awkward kind. */
  moving: number
  crumble: number
  spring: number
}

const SHAPES: Record<Difficulty, Shape> = {
  easy: { gap: [60, 95], span: [30, 50], moving: 10, crumble: 5, spring: 10 },
  normal: { gap: [70, 115], span: [40, 70], moving: 20, crumble: 14, spring: 8 },
  hard: { gap: [80, 128], span: [50, 90], moving: 30, crumble: 24, spring: 6 }
}

export const START_LEDGE: Ledge = { y: 0, x: (WIDTH - LEDGE_W) / 2, kind: 'solid', span: 0, period: 0 }

/**
 * The next stretch of climb, every ledge of it reachable from the one below.
 *
 * `index` is how many ledges have been made already, so the seed and the index together decide the climb -- the same
 * seed always gives the same tower, however it is asked for.
 */
export function makeLedges(seed: number, difficulty: Difficulty, from: Ledge, index: number, count: number): Ledge[] {
  const rng = seeded((seed + index * 2654435761) >>> 0)
  const shape = SHAPES[difficulty]
  const out: Ledge[] = []
  let below = from
  for (let i = 0; i < count; i++) {
    const high = index + i
    // The climb tightens for the first three hundred ledges and then holds, so it never becomes impossible.
    const tighten = Math.min(1, high / 300)
    const low = Math.round(shape.gap[0] + (shape.gap[1] - shape.gap[0]) * tighten * 0.5)
    const top = Math.min(Math.round(maxRise() * 0.8), Math.round(shape.gap[1] * (0.8 + 0.2 * tighten)))
    let ledge: Ledge | null = null
    for (let attempt = 0; attempt < 40 && !ledge; attempt++) {
      const dy = range(rng, Math.min(low, top), top)
      const roll = range(rng, 1, 100)
      const kind: LedgeKind = high < 3 ? 'solid' : roll <= shape.moving ? 'moving' : roll <= shape.moving + shape.crumble ? 'crumble' : roll <= shape.moving + shape.crumble + shape.spring ? 'spring' : 'solid'
      const span = kind === 'moving' ? range(rng, shape.span[0], shape.span[1]) : 0
      const x = range(rng, 0, Math.max(0, Math.round(WIDTH - LEDGE_W - span)))
      const candidate: Ledge = { y: below.y + dy, x, kind, span, period: kind === 'moving' ? 2 + rng() * 2 : 0 }
      if (reachable(below, candidate)) ledge = candidate
    }
    // Forty tries and nothing fits: put one straight above, which always does.
    ledge ??= { y: below.y + Math.min(Math.round(maxRise() * 0.6), shape.gap[0]), x: Math.min(WIDTH - LEDGE_W, Math.max(0, below.x)), kind: 'solid', span: 0, period: 0 }
    out.push(ledge)
    below = ledge
  }
  return out
}

/** A hundred points for every screen's worth of climbing, and nothing at all for falling back down. */
export const climbScore = (height: number): number => Math.max(0, Math.round(height / 6))

/** What a landing throws you back up at. A spring is the only thing that changes it. */
export const bounceFrom = (kind: LedgeKind): number => (kind === 'spring' ? SPRING_V : JUMP_V)

/** A few words about what the player just landed on, for the line across the top. */
export function ledgeWords(kind: LedgeKind): string {
  if (kind === 'spring') return 'A spring: that one throws you much higher'
  if (kind === 'crumble') return 'That ledge went as you left it'
  if (kind === 'moving') return 'That one slides'
  return ''
}
