/**
 * The arcade's seeded randomness.
 *
 * A level that is generated from a seed can be generated again -- by the game when somebody continues it, and by a test
 * when it wants to check a thousand of them. `Math.random` cannot do either, so nothing in `src/shared/games` uses it.
 */

/**
 * A small, fast generator. The same seed always gives the same run of numbers, in every browser and in Node.
 *
 * The seed is stirred and the first few numbers are thrown away on purpose. Fed a small seed raw, this kind of
 * generator answers something very near zero the first two or three times -- so seed 1, 2 and 3 all gave a first
 * reading of about 0.00006, and every level built from them began with the same lane at the same speed.
 */
export function seeded(seed: number): () => number {
  let s = (Math.imul(seed >>> 0, 0x9e3779b9) ^ 0x85ebca6b) >>> 0 || 0x9e3779b9
  const next = (): number => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
  for (let i = 0; i < 6; i++) next()
  return next
}

/** A whole number from min to max, both ends included. */
export const range = (rng: () => number, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1))

/** One of the items. Never called with an empty list. */
export const pick = <T>(rng: () => number, items: readonly T[]): T => items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
