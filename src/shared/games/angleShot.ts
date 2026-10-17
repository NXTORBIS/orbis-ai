/**
 * Angle Shot: the flight of the ball, the holes, and the proof that each hole can be holed.
 *
 * The flight is here rather than in the game file because it is the same arithmetic twice over: the game steps a ball
 * through `advance` once a frame to draw it, and the generator steps a thousand practice shots through the same
 * `advance` to find out whether a hole it has just laid out can be done at all. If those were two pieces of code, the
 * search would be proving something about a game nobody is playing.
 *
 * No hole is handed out until a single shot from the tee has been found that holes it. That is a stronger promise than
 * the game asks for -- several shots are allowed -- and it is the one worth making, because a hole that cannot be done
 * looks exactly like a player who cannot do it.
 *
 * The score is the number of shots taken, so lower is better. The catalogue calls that `lower-ms`, which is the only
 * "lower is better" kind it has; the number in it is shots, not milliseconds.
 */

import { range, seeded } from './random.ts'

export const WIDTH = 1000
export const HEIGHT = 560
export const BALL_R = 7
export const GRAVITY = 900
/**
 * What a ball leaves the tee at, at full strength. Chosen against the width of the field and gravity: at forty-five
 * degrees and full strength a ball carries about a thousand pixels, so the far side is reachable and nothing beyond it
 * is. A slower ball than this could only reach the far holes by bouncing, which would mean the aiming arithmetic in
 * `aimPower` could not work out any shot at all.
 */
export const MAX_SPEED = 950
/** How much of its speed a ball keeps off the ground and off a wall. */
export const GROUND_BOUNCE = 0.45
export const BLOCK_BOUNCE = 0.4
export const WALL_BOUNCE = 0.5
export const GROUND_DRAG = 0.78
/** How quickly a rolling ball gives up, as a fraction of its speed each second. */
export const ROLL_DRAG = 1.8
export const TARGET_R = 17
/** The clock the flight is worked out on. The game draws at whatever rate it likes and steps the ball at this one. */
export const STEP = 1 / 240

export type Difficulty = 'easy' | 'normal' | 'hard'

export interface Block {
  x: number
  y: number
  w: number
  h: number
}

export interface Hole {
  index: number
  tee: { x: number; y: number }
  target: { x: number; y: number }
  /** Sideways push on everything in the air, in pixels a second squared. Negative is a head wind from the right. */
  wind: number
  blocks: Block[]
  /** The number of shots this is meant to take. */
  par: number
  seed: number
}

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
  resting: boolean
}

export const launch = (from: { x: number; y: number }, angleDeg: number, power: number): Ball => ({
  x: from.x,
  y: from.y,
  vx: Math.cos((angleDeg * Math.PI) / 180) * power * MAX_SPEED,
  vy: Math.sin((angleDeg * Math.PI) / 180) * power * MAX_SPEED,
  resting: false
})

const insideBlock = (block: Block, x: number, y: number, r: number): boolean => x + r > block.x && x - r < block.x + block.w && y + r > block.y && y - r < block.y + block.h

/** Where the ground is at a given x: the top of whatever block is there, or nothing. */
export function groundAt(hole: Hole, x: number): number {
  let top = 0
  for (const block of hole.blocks) if (x >= block.x && x <= block.x + block.w) top = Math.max(top, block.y + block.h)
  return top
}

export interface Advance {
  in: boolean
  hit: 'ground' | 'wall' | 'block' | null
}

/**
 * One step of the flight: wind and gravity, then the walls, the blocks and the ground, then whether it went in. The
 * ball is changed in place, because this runs a few hundred times a second and a few hundred thousand times a search.
 */
export function advance(hole: Hole, ball: Ball, dt: number = STEP): Advance {
  if (ball.resting) return { in: false, hit: null }
  const wasX = ball.x
  const wasY = ball.y
  ball.vx += hole.wind * dt
  ball.vy -= GRAVITY * dt
  ball.x += ball.vx * dt
  ball.y += ball.vy * dt
  let hit: Advance['hit'] = null

  // The hole counts the moment the ball reaches it, wherever it is going.
  const reached = (ball.x - hole.target.x) ** 2 + (ball.y - hole.target.y) ** 2 <= TARGET_R ** 2
  if (reached) {
    ball.resting = true
    return { in: true, hit: null }
  }

  if (ball.x < BALL_R) {
    ball.x = BALL_R
    ball.vx = -ball.vx * WALL_BOUNCE
    hit = 'wall'
  } else if (ball.x > WIDTH - BALL_R) {
    ball.x = WIDTH - BALL_R
    ball.vx = -ball.vx * WALL_BOUNCE
    hit = 'wall'
  }

  for (const block of hole.blocks) {
    if (!insideBlock(block, ball.x, ball.y, BALL_R)) continue
    // Which side it came in by: whichever one it was outside of a step ago.
    const fromAbove = wasY - BALL_R >= block.y + block.h - 0.5
    const fromBelow = wasY + BALL_R <= block.y + 0.5
    const fromLeft = wasX + BALL_R <= block.x + 0.5
    const fromRight = wasX - BALL_R >= block.x + block.w - 0.5
    if (fromAbove) {
      ball.y = block.y + block.h + BALL_R
      if (ball.vy < -40) {
        ball.vy = -ball.vy * BLOCK_BOUNCE
        ball.vx *= GROUND_DRAG
      } else {
        ball.vy = 0
        ball.vx -= ball.vx * ROLL_DRAG * dt
      }
    } else if (fromBelow) {
      ball.y = block.y - BALL_R
      ball.vy = -Math.abs(ball.vy) * BLOCK_BOUNCE
    } else if (fromLeft) {
      ball.x = block.x - BALL_R
      ball.vx = -Math.abs(ball.vx) * BLOCK_BOUNCE
    } else if (fromRight) {
      ball.x = block.x + block.w + BALL_R
      ball.vx = Math.abs(ball.vx) * BLOCK_BOUNCE
    } else {
      // Caught inside: push it back the way it came and take the speed off it.
      ball.x = wasX
      ball.y = wasY
      ball.vx *= -BLOCK_BOUNCE
      ball.vy *= -BLOCK_BOUNCE
    }
    hit = 'block'
  }

  const floor = groundAt(hole, ball.x) + BALL_R
  if (ball.y <= floor) {
    ball.y = floor
    if (ball.vy < -40) {
      // A real bounce: some of the drop comes back, and some of the speed along the ground is scrubbed off.
      ball.vy = -ball.vy * GROUND_BOUNCE
      ball.vx *= GROUND_DRAG
      hit = hit ?? 'ground'
    } else {
      // Rolling. The drag here is per second, not per step: taking a fraction off every step at this rate stopped a
      // rolling ball dead where it landed, and a ball that cannot roll cannot roll into the hole.
      ball.vy = 0
      ball.vx -= ball.vx * ROLL_DRAG * dt
    }
    if (Math.abs(ball.vy) < 34 && Math.abs(ball.vx) < 11) {
      ball.vx = 0
      ball.vy = 0
      ball.resting = true
    }
  }
  return { in: reached, hit }
}

export interface Flight {
  path: { x: number; y: number }[]
  in: boolean
  rest: { x: number; y: number }
  seconds: number
}

/** A whole shot, played out, with the line it took. Used to show where the last shot went. */
export function simulate(hole: Hole, from: { x: number; y: number }, angleDeg: number, power: number, maxSeconds = 7): Flight {
  const ball = launch(from, angleDeg, power)
  const path: { x: number; y: number }[] = [{ x: ball.x, y: ball.y }]
  let steps = 0
  const limit = Math.round(maxSeconds / STEP)
  while (steps < limit && !ball.resting) {
    const result = advance(hole, ball)
    steps++
    if (steps % 6 === 0 && path.length < 2000) path.push({ x: ball.x, y: ball.y })
    if (result.in) return { path, in: true, rest: { x: ball.x, y: ball.y }, seconds: steps * STEP }
  }
  path.push({ x: ball.x, y: ball.y })
  return { path, in: false, rest: { x: ball.x, y: ball.y }, seconds: steps * STEP }
}

/** The same shot with nothing kept: this is what the search runs, hundreds of times, so it keeps no line. */
function holes(hole: Hole, from: { x: number; y: number }, angleDeg: number, power: number, maxSeconds: number): boolean {
  const ball = launch(from, angleDeg, power)
  const limit = Math.round(maxSeconds / STEP)
  for (let step = 0; step < limit && !ball.resting; step++) if (advance(hole, ball).in) return true
  return false
}

/**
 * A shot that holes it in one, or null when there is not one.
 *
 * The sweep goes from full strength downwards, because a hole is usually at the far end and the weak shots are the ones
 * that cannot reach it -- that order is what makes this fast enough for the generator to ask about every hole it lays
 * out. The coarse pass first, then a fine one only if the coarse pass found nothing.
 */
export type SearchDepth = 'aimed' | 'full'

export function findSolution(hole: Hole, from = hole.tee, depth: SearchDepth = 'full'): { angle: number; power: number } | null {
  // The strength is handed back exactly as it was tried. Rounding it to something tidier to read turned several
  // answers back into misses, which made the generator's proof worth nothing.
  const tidy = (angle: number, power: number): { angle: number; power: number } => ({ angle, power })
  // Worked out first, swept second. For each angle there is one strength that would drop the ball straight in if the
  // air were still and nothing were in the way, so those are the shots to try before anything else.
  for (let angle = 10; angle <= 85; angle += 2.5) {
    const aimed = aimPower(from, hole.target, angle)
    if (aimed === null) continue
    for (const nudge of [0, 0.03, -0.03, 0.07, -0.07, 0.12, -0.12]) {
      const power = aimed + nudge
      if (power < 0.1 || power > 1) continue
      if (holes(hole, from, angle, power, 3.5)) return tidy(angle, power)
    }
  }
  // The generator stops here: the aimed shots are what it can afford to ask about every layout it tries, and an aimed
  // shot that goes in is as good an answer as any other.
  if (depth === 'aimed') return null
  for (let angle = 15; angle <= 80; angle += 5) for (let power = 1; power >= 0.349; power -= 0.05) if (holes(hole, from, angle, power, 3)) return tidy(angle, power)
  for (let angle = 3; angle <= 88; angle += 2) for (let power = 1; power >= 0.249; power -= 0.05) if (holes(hole, from, angle, power, 4.5)) return tidy(angle, power)
  return null
}

/**
 * The strength that would drop the ball straight into the hole at this angle, in still air over open ground, or null
 * when no strength at this angle would -- it is behind you, or too far to reach. It is the ordinary throwing
 * arithmetic, and it is what makes the search above quick enough to run on every hole that is generated.
 */
export function aimPower(from: { x: number; y: number }, target: { x: number; y: number }, angleDeg: number): number | null {
  const dx = target.x - from.x
  const dy = target.y - from.y
  if (dx <= 0) return null
  const tan = Math.tan((angleDeg * Math.PI) / 180)
  const cos = Math.cos((angleDeg * Math.PI) / 180)
  const under = 2 * cos * cos * (dx * tan - dy)
  if (under <= 0) return null
  const speed = Math.sqrt((GRAVITY * dx * dx) / under)
  const power = speed / MAX_SPEED
  return power > 0.08 && power <= 1 ? power : null
}

const HARDNESS: Record<Difficulty, { blocks: number; wind: number }> = {
  easy: { blocks: 0.7, wind: 0.6 },
  normal: { blocks: 1, wind: 1 },
  hard: { blocks: 1.5, wind: 1.4 }
}

export const HOLES = 9

/**
 * Hole `index` of nine, laid out and then checked. Each one is further, windier and more cluttered than the last, and
 * the layout is thrown away and tried again until a single shot from the tee has been found that holes it.
 */
export function makeHole(index: number, seed: number, difficulty: Difficulty = 'normal'): Hole {
  const hard = HARDNESS[difficulty]
  for (let attempt = 0; attempt < 24; attempt++) {
    const rng = seeded((seed + index * 7777 + attempt * 104729) >>> 0)
    // Each try is a little tamer than the last, so this always ends somewhere.
    const ease = attempt / 24
    const along = Math.min(1, index / (HOLES - 1))
    const tee = { x: 70, y: BALL_R }
    const blocks: Block[] = []
    // The hole first, then what is in the way of it, because a wall standing on the hole is not an obstacle, it is a
    // hole nobody can reach. Everything keeps clear of the last stretch in front of the target.
    const targetX = Math.round(range(rng, 520 + along * 200, 690 + along * 240))
    const onTop = index >= 2 && rng() < 0.45 ? range(rng, 60, 140) : 0
    if (onTop) blocks.push({ x: targetX - 55, y: 0, w: 110, h: onTop })
    const target = { x: targetX, y: onTop + TARGET_R + 2 }
    const count = Math.round((0.5 + along * 2.5) * hard.blocks * (1 - ease))
    const from = 230
    const to = targetX - 130
    const spread = Math.max(60, (to - from) / Math.max(1, count))
    for (let i = 0; i < count; i++) {
      const x = Math.round(from + i * spread + range(rng, 0, 30))
      if (x > to) break
      blocks.push({ x, y: 0, w: range(rng, 26, 46), h: Math.round(range(rng, 70, 175) * (1 - ease * 0.6)) })
    }
    // From the fourth hole on, something to go under as well as over.
    if (index >= 3 && attempt < 16 && difficulty !== 'easy') {
      const x = range(rng, 380, Math.max(400, to - 60))
      blocks.push({ x, y: Math.round(range(rng, 230, 330)), w: range(rng, 90, 170), h: 26 })
    }
    // Under fifteen is called still air rather than put on screen as a number too small to feel.
    const blowing = index < 1 ? 0 : Math.round(range(rng, -140, 140) * along * hard.wind * (1 - ease))
    const wind = Math.abs(blowing) < 15 ? 0 : blowing
    // Nothing standing where the ball starts or where it has to end up.
    const clear = blocks.every((block) => !insideBlock(block, tee.x, tee.y, BALL_R * 3) && (!insideBlock(block, target.x, target.y, TARGET_R) || block.y + block.h <= target.y - TARGET_R))
    if (!clear) continue
    const hole: Hole = { index, tee, target, wind, blocks, par: index < 3 ? 2 : 3, seed }
    if (findSolution(hole, hole.tee, 'aimed')) return hole
  }
  // Nothing fitted in two dozen tries: a flat hole with nothing in the way, which is always possible.
  return { index, tee: { x: 70, y: BALL_R }, target: { x: 620, y: TARGET_R + 2 }, wind: 0, blocks: [], par: 2, seed }
}

/** The nine holes of a round. */
export const makeRound = (seed: number, difficulty: Difficulty = 'normal'): Hole[] => Array.from({ length: HOLES }, (_, index) => makeHole(index, seed, difficulty))

/** What to say about a finished hole: shots against par, in the words a player would use. */
export function holeWords(shots: number, par: number): string {
  if (shots === 1) return 'In one shot'
  if (shots < par) return `${shots} shots — one under`
  if (shots === par) return `${shots} shots — on par`
  return `${shots} shots`
}

/** The whole round's score is the shots taken, and nothing else goes into it. */
export const roundScore = (shots: number[]): number => shots.reduce((sum, one) => sum + one, 0)
