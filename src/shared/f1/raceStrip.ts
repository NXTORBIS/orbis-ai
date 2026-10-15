/**
 * Where each car sits on the Arena's race strip: the leader at the right, everyone else to the left by how far behind
 * the timing says they are. Only the feed's own gap is used: a car whose gap is not a number of seconds (a lap down, or
 * not given) is not placed on the time scale and is drawn at the left edge, marked as lapped, never at a made-up spot.
 */

/** "+12.345" or "12.3" -> seconds; "LAP 5", "1L", "" -> null. */
export function gapSeconds(text: string | null): number | null {
  if (text === null) return null
  const m = /^\+?\s*(\d{1,4}(?:\.\d{1,3})?)\s*s?$/.exec(text.trim())
  return m ? Number(m[1]) : null
}

export interface StripCar {
  number: string
  code: string
  colour: string | null
  position: number | null
  /** 0 (far left) to 100 (the leader). */
  x: number
  /** True when the car is not on the time scale. */
  lapped: boolean
}

export interface StripInput {
  number: string
  code: string
  colour: string | null
  position: number | null
  gapToLeader: string | null
}

const LEFT = 4
const RIGHT = 94

/** The scale is the largest real gap, but never narrower than ten seconds and never wider than two minutes. */
export function placeCars(cars: readonly StripInput[]): { cars: StripCar[]; scaleSeconds: number } {
  const gaps = cars.map((c) => (c.position === 1 ? 0 : gapSeconds(c.gapToLeader))).filter((g): g is number => g !== null)
  const scale = Math.min(120, Math.max(10, ...gaps))
  const out = cars
    .filter((c) => c.position !== null)
    .map((c): StripCar => {
      const g = c.position === 1 ? 0 : gapSeconds(c.gapToLeader)
      if (g === null) return { number: c.number, code: c.code, colour: c.colour, position: c.position, x: LEFT, lapped: true }
      const x = RIGHT - (Math.min(g, scale) / scale) * (RIGHT - LEFT - 6)
      return { number: c.number, code: c.code, colour: c.colour, position: c.position, x: Math.round(x * 10) / 10, lapped: false }
    })
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
  return { cars: out, scaleSeconds: scale }
}
