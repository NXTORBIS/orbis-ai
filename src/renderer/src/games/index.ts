import type { GameId } from '../../../shared/offlineGames'
import type { GameModule } from './engine'

/**
 * The game registry: each game is its own chunk, loaded only when someone opens it, so the offline games cost nothing
 * until they are used.
 */
export const GAME_LOADERS: Record<GameId, () => Promise<{ default: GameModule }>> = {
  runner: () => import('./runner'),
  'space-dodger': () => import('./spaceDodger'),
  'orb-collector': () => import('./orbCollector'),
  'block-breaker': () => import('./blockBreaker'),
  snake: () => import('./snake'),
  'arcade-shooter': () => import('./arcadeShooter'),
  flappy: () => import('./flappy'),
  'memory-match': () => import('./memoryMatch'),
  minesweeper: () => import('./minesweeper'),
  'number-puzzle': () => import('./numberPuzzle'),
  'reaction-test': () => import('./reactionTest'),
  'typing-challenge': () => import('./typingChallenge')
}
