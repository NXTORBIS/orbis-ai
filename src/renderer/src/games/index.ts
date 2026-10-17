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
  'typing-challenge': () => import('./typingChallenge'),
  stacker: () => import('./stacker'),
  sokoban: () => import('./sokoban'),
  'lights-out': () => import('./lightsOut'),
  pipes: () => import('./pipes'),
  solitaire: () => import('./solitaire'),
  sudoku: () => import('./sudoku'),
  nonogram: () => import('./nonogram'),
  'match-three': () => import('./matchThree'),
  'water-sort': () => import('./waterSort'),
  'sliding-tiles': () => import('./slidingTiles'),
  'sequence-memory': () => import('./sequenceMemory'),
  'connect-four': () => import('./connectFour'),
  'maze-chase': () => import('./mazeChase'),
  'asteroid-field': () => import('./asteroidField'),
  'paddle-duel': () => import('./paddleDuel'),
  'road-cross': () => import('./roadCross'),
  'tower-defence': () => import('./towerDefence'),
  'platform-climb': () => import('./platformClimb'),
  'rhythm-tap': () => import('./rhythmTap'),
  'angle-shot': () => import('./angleShot')
}
