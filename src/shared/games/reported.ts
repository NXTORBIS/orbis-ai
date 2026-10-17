/**
 * What a game in the arcade reports about itself while it is being played.
 *
 * Here rather than in the game engine, and the move is worth the sentence. The engine is browser code -- a canvas, a
 * keyboard, an audio context -- and this shape is also what the arcade's surface declaration hands to Orbis, so that
 * `src/renderer/src/components/arcadeSurfaces.ts` can say what a game is doing. Importing it from the engine pulled
 * the whole engine into the main process's typecheck, where there is no `HTMLCanvasElement` and no `window`, and
 * broke that typecheck with a page of errors about a file nobody was changing.
 *
 * So the shape lives where both halves can read it, with no DOM in sight, and the engine imports it back. One
 * definition, which is the point: a second copy here would be two opinions about what a game reports, and the game
 * would win.
 */

/** Where a game is: waiting to start, being played, held, or finished. */
export type GameStatus = 'ready' | 'running' | 'paused' | 'over'

/** What a game reports about itself: real state, for the score bar and diagnostics. */
export interface GameState {
  status: GameStatus
  score: number
  level?: number
  lives?: number
  elapsedMs: number
  /** How hard it is right now (1 = starting difficulty). */
  difficulty: number
  hud?: { label: string; value: string | number }[]
}
