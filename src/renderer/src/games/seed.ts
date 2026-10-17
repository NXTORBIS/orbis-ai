import { seeded, type GameContext } from './engine'

/**
 * The day's seed, where a game's own layout comes from a random source.
 *
 * The window puts the seed on the stage as `data-game-seed` when a run is the day's challenge, and takes it off again
 * for ordinary play. A game asks for its random source here and uses the answer for every random choice it makes --
 * where the food goes, which passage comes up, how long the wait is -- so with a seed the run is the same all day and
 * without one it is as varied as it ever was.
 *
 * A game that still calls `Math.random` for part of its layout is a game whose board the seed does not really fix, so
 * `src/shared/games/daily.test.ts` refuses to let such a game be listed as taking the seed.
 */
export function gameRandom(ctx: GameContext): () => number {
  const seed = gameSeed(ctx)
  return seed === null ? Math.random : seeded(seed)
}

/** The seed itself, for a game that wants to show it or lay out from it directly. Null for ordinary play. */
export function gameSeed(ctx: GameContext): number | null {
  const raw = Number(ctx.root.dataset.gameSeed)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null
}
