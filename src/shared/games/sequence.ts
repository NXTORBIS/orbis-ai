/**
 * Follow Along: the pattern, the timing and the points.
 *
 * Two things here are not as obvious as they look. A pattern made of pure chance will happily light the same panel
 * five times running, which nobody can read back and nobody enjoys — so no panel is ever used three times in a row.
 * And the pattern speeds up as it grows, but never past the point where watching it is a reflex test rather than a
 * memory one; the floor on the timing is what keeps it a memory game.
 */

export const PANEL_COUNT = 4

/** One tone per panel, so the pattern can be heard as well as seen. A chord, so a wrong note is obvious. */
export const PANEL_TONES = [329.63, 392, 493.88, 587.33]

/** What each panel is called, for the player and for a screen reader. */
export const PANEL_NAMES = ['top left', 'top right', 'bottom left', 'bottom right']

export type SequenceDifficulty = 'easy' | 'normal' | 'hard'

export interface SequenceLevel {
  /** How long a panel stays lit at the start, in milliseconds. */
  lit: number
  /** The dark gap between two panels, in milliseconds. */
  gap: number
  /** How much of the timing a long pattern takes off, as a share. */
  quicken: number
  /** Mistakes allowed before the game ends. */
  mistakes: number
  /** How long you get for each press, in milliseconds; 0 means as long as you like. */
  pressLimit: number
  /** How many panels the pattern grows by each round. */
  grow: number
  /** From this round on, the pattern grows by two at a time. */
  doubleFrom: number
}

export const SEQUENCE_LEVELS: Record<SequenceDifficulty, SequenceLevel> = {
  easy: { lit: 620, gap: 260, quicken: 0.3, mistakes: 2, pressLimit: 0, grow: 1, doubleFrom: Infinity },
  normal: { lit: 440, gap: 170, quicken: 0.45, mistakes: 1, pressLimit: 3500, grow: 1, doubleFrom: Infinity },
  hard: { lit: 300, gap: 95, quicken: 0.55, mistakes: 0, pressLimit: 2200, grow: 1, doubleFrom: 6 }
}

/** How much longer the pattern gets at the end of a round. */
export const growBy = (level: SequenceLevel, round: number): number => (round >= level.doubleFrom ? level.grow + 1 : level.grow)

/**
 * The pattern with its next panels added. No panel is used three times running: a pattern that reads as "that one
 * again" is not a pattern.
 */
export function growPattern(pattern: number[], random: () => number, add = 1): number[] {
  const next = pattern.slice()
  for (let i = 0; i < add; i++) {
    let panel = Math.floor(random() * PANEL_COUNT) % PANEL_COUNT
    const last = next.at(-1)
    const before = next.at(-2)
    if (last !== undefined && last === before && last === panel) panel = (panel + 1 + Math.floor(random() * (PANEL_COUNT - 1))) % PANEL_COUNT
    next.push(panel)
  }
  return next
}

/** How long each panel lights for, and the gap between them: quicker as the pattern grows, down to a floor. */
export function playbackTiming(level: SequenceLevel, length: number): { lit: number; gap: number } {
  const quicken = Math.max(1 - level.quicken, 1 - (length - 1) * 0.035 * (1 + level.quicken))
  return { lit: Math.max(150, Math.round(level.lit * quicken)), gap: Math.max(60, Math.round(level.gap * quicken)) }
}

/** How a round of presses is going: right so far, finished, or wrong. */
export function checkPresses(pattern: number[], pressed: number[]): 'correct' | 'wrong' | 'unfinished' {
  if (pressed.length > pattern.length) return 'wrong'
  for (let i = 0; i < pressed.length; i++) if (pressed[i] !== pattern[i]) return 'wrong'
  return pressed.length === pattern.length ? 'correct' : 'unfinished'
}

/**
 * A round's points: longer patterns are worth more than short ones, playing it back without pausing is worth more
 * than creeping through it, and the harder settings count for more.
 */
export function roundScore(round: number, difficulty: SequenceDifficulty, ms: number, length: number): number {
  const weight = difficulty === 'hard' ? 3 : difficulty === 'normal' ? 2 : 1
  const allowed = Math.max(1, length) * 1400
  const brisk = Math.max(0, Math.min(1, 1 - ms / allowed))
  return Math.round((20 * round + 30 * brisk * round) * weight)
}
