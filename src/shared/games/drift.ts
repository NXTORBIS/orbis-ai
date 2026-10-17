/**
 * Drift: the rocks, and the sums the game cannot be allowed to get wrong.
 *
 * Everything happens on a fixed field of 1000 by 625 units that the game scales onto the canvas, so a rock moves at
 * the same speed whatever size the window is. The field has no edges: leaving one side brings you in at the other,
 * which is why distance is measured the short way round rather than straight across.
 *
 * A shot does not destroy a big rock, it breaks it: a big one into two middling ones, a middling one into two small
 * ones, and a small one into nothing. The pieces are quicker than what they came from, so clearing a field gets more
 * frantic rather than easier. The jump is the other honest rule here: it moves you somewhere else on the field, and
 * when there is nowhere clear to land it says so instead of quietly putting you inside a rock.
 */

export const FIELD = { width: 1000, height: 625 }

export type RockSize = 1 | 2 | 3

export interface Rock {
  x: number
  y: number
  vx: number
  vy: number
  size: RockSize
  angle: number
  /** How fast it turns, radians a second. */
  spin: number
  /** The rim, as multiples of the radius: a lumpy rock rather than a circle. */
  rim: number[]
}

export const ROCK_RADIUS: Record<RockSize, number> = { 3: 48, 2: 27, 1: 14 }

/** Small rocks are worth most: they are the hardest to hit. */
export const rockScore = (size: RockSize): number => (size === 3 ? 20 : size === 2 ? 50 : 100)

export const wrap = (value: number, max: number): number => ((value % max) + max) % max

/** The gap between two points on a field with no edges: whichever way round is shorter. */
export function wrappedGap(a: number, b: number, max: number): number {
  let d = b - a
  if (d > max / 2) d -= max
  if (d < -max / 2) d += max
  return d
}

export function overlaps(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = wrappedGap(ax, bx, FIELD.width)
  const dy = wrappedGap(ay, by, FIELD.height)
  return dx * dx + dy * dy < (ar + br) * (ar + br)
}

export const hitsRock = (rock: Rock, x: number, y: number, radius: number): boolean => overlaps(rock.x, rock.y, ROCK_RADIUS[rock.size], x, y, radius)

/** A rock's outline: the same rock always has the same lumps, so it reads as one object as it turns. */
export function rockRim(random: () => number, points = 11): number[] {
  return Array.from({ length: points }, () => 0.72 + random() * 0.42)
}

export function makeRock(x: number, y: number, size: RockSize, speed: number, random: () => number): Rock {
  const heading = random() * Math.PI * 2
  return { x, y, vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed, size, angle: random() * Math.PI * 2, spin: (random() - 0.5) * 1.6, rim: rockRim(random) }
}

/** What a rock breaks into: two of the next size down, quicker than their parent, and nothing at all from a small one. */
export function splitRock(rock: Rock, random: () => number): Rock[] {
  if (rock.size === 1) return []
  const size = (rock.size - 1) as RockSize
  const parentSpeed = Math.hypot(rock.vx, rock.vy)
  const heading = Math.atan2(rock.vy, rock.vx)
  return [1, -1].map((side) => {
    const turn = (0.4 + random() * 0.7) * side
    const speed = Math.max(40, parentSpeed * (1.3 + random() * 0.35))
    return {
      x: rock.x,
      y: rock.y,
      vx: Math.cos(heading + turn) * speed,
      vy: Math.sin(heading + turn) * speed,
      size,
      angle: random() * Math.PI * 2,
      spin: (random() - 0.5) * 2.4,
      rim: rockRim(random)
    }
  })
}

export interface DriftLevel {
  lives: number
  /** Units a second for the first wave's big rocks. */
  rockSpeed: number
  /** How many rocks the first wave holds. */
  waveBase: number
  /** The chance a jump kills you even when the spot is clear. */
  risk: number
  /** Seconds of grace after a respawn. */
  grace: number
  /** Shots allowed on the field at once. */
  shots: number
  /** Seconds between jumps. */
  jumpCooldown: number
}

export const DRIFT_LEVELS: Record<'easy' | 'normal' | 'hard', DriftLevel> = {
  easy: { lives: 4, rockSpeed: 52, waveBase: 3, risk: 0.08, grace: 2.6, shots: 5, jumpCooldown: 2.5 },
  normal: { lives: 3, rockSpeed: 72, waveBase: 4, risk: 0.15, grace: 2, shots: 4, jumpCooldown: 3.5 },
  hard: { lives: 3, rockSpeed: 96, waveBase: 5, risk: 0.24, grace: 1.3, shots: 4, jumpCooldown: 5 }
}

/** How many big rocks a wave starts with, and how fast they drift. Both grow, the speed only up to a point. */
export const waveCount = (wave: number, level: DriftLevel): number => Math.min(11, level.waveBase + wave - 1)
export const waveSpeed = (wave: number, level: DriftLevel): number => Math.min(level.rockSpeed * 2.2, level.rockSpeed * (1 + (wave - 1) * 0.12))

/** A new wave of big rocks, none of them dropped on top of the ship. */
export function waveRocks(wave: number, level: DriftLevel, safe: { x: number; y: number }, random: () => number): Rock[] {
  const rocks: Rock[] = []
  const want = waveCount(wave, level)
  const speed = waveSpeed(wave, level)
  for (let i = 0; i < want; i++) {
    let x = 0
    let y = 0
    for (let tries = 0; tries < 60; tries++) {
      x = random() * FIELD.width
      y = random() * FIELD.height
      const dx = wrappedGap(x, safe.x, FIELD.width)
      const dy = wrappedGap(y, safe.y, FIELD.height)
      if (Math.hypot(dx, dy) > 190) break
    }
    rocks.push(makeRock(x, y, 3, speed * (0.7 + random() * 0.6), random))
  }
  return rocks
}

/**
 * Where a jump lands you. It looks for a spot clear of every rock; when the field is too crowded to find one it
 * returns the best it found and says the spot is not clear, and the game kills you there. A jump that quietly dropped
 * you inside a rock would look like a bug, and a jump that always found room would not be a risk at all.
 */
export function jumpSpot(rocks: Rock[], clearance: number, random: () => number): { x: number; y: number; clear: boolean } {
  let best = { x: FIELD.width / 2, y: FIELD.height / 2, gap: -Infinity }
  for (let tries = 0; tries < 80; tries++) {
    const x = 40 + random() * (FIELD.width - 80)
    const y = 40 + random() * (FIELD.height - 80)
    let gap = Infinity
    for (const rock of rocks) {
      const dx = wrappedGap(x, rock.x, FIELD.width)
      const dy = wrappedGap(y, rock.y, FIELD.height)
      gap = Math.min(gap, Math.hypot(dx, dy) - ROCK_RADIUS[rock.size])
    }
    if (gap > best.gap) best = { x, y, gap }
    if (gap >= clearance) return { x, y, clear: true }
  }
  return { x: best.x, y: best.y, clear: best.gap >= clearance }
}

/** The whole field cleared is worth more each time, because each wave was harder than the last. */
export const waveBonus = (wave: number): number => 250 * wave
