/**
 * Paddle Duel: where the ball goes, and how the opponent works it out.
 *
 * The court is a fixed 1000 by 600 units that the game scales onto the canvas, so the ball crosses it in the same
 * time whatever size the window is.
 *
 * Two rules carry the game. Where the ball hits the paddle decides the angle it leaves at — the middle sends it
 * straight back, the ends send it away at up to sixty degrees — and every return is a little faster than the last, so
 * a long rally ends up quicker than either player can really handle. The opponent reads the ball's angle and works
 * out where it will cross its own line, bounces and all, then aims at that spot with an error it keeps for the whole
 * rally. An opponent that reads the angle perfectly cannot be beaten and is no fun; one that jitters its error every
 * frame looks broken. So the error is real, and it is steady.
 */

export const COURT = { width: 1000, height: 600 }

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
}

/** The sharpest angle the ball can leave a paddle at, away from straight. */
export const MAX_BOUNCE = (60 * Math.PI) / 180
/** Every return is this much faster than the one before. */
export const RALLY_STEP = 1.045
export const SERVE_SPEED = 430
export const SPEED_CAP = 1250

export const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

/**
 * Where the ball will cross a line, with its bounces off the top and bottom folded in. Null when it is not going
 * that way at all. The fold: the ball's path repeats every two court heights, once down and once back up.
 */
export function predictCrossing(ball: Ball, lineX: number, top: number, bottom: number): number | null {
  if (!ball.vx) return null
  const travel = (lineX - ball.x) / ball.vx
  if (travel <= 0) return null
  const height = bottom - top
  if (height <= 0) return null
  const straight = ball.y + ball.vy * travel
  const span = height * 2
  const folded = (((straight - top) % span) + span) % span
  return top + (folded <= height ? folded : span - folded)
}

export interface BounceResult {
  vx: number
  vy: number
  /** Where on the paddle it struck, -1 at the top end, 0 in the middle, 1 at the bottom end. */
  offset: number
  speed: number
}

/**
 * The ball off a paddle: the angle comes from where it hit, the paddle's own movement bends it a little further, and
 * the speed steps up for the rally.
 */
export function bounceOffPaddle(options: { ballY: number; paddleCentre: number; paddleHalf: number; speed: number; toRight: boolean; paddleVy?: number }): BounceResult {
  const offset = clamp((options.ballY - options.paddleCentre) / Math.max(1, options.paddleHalf), -1, 1)
  const bend = clamp((options.paddleVy ?? 0) / 2600, -0.28, 0.28)
  const angle = clamp(offset * MAX_BOUNCE + bend, -MAX_BOUNCE, MAX_BOUNCE)
  const speed = Math.min(SPEED_CAP, options.speed * RALLY_STEP)
  return { vx: Math.cos(angle) * speed * (options.toRight ? 1 : -1), vy: Math.sin(angle) * speed, offset, speed }
}

export interface PaddleSkill {
  /** How fast the opponent's paddle can move, units a second. */
  speed: number
  /** How far out its reading can be, as a share of the court's height. */
  error: number
  /** It only starts moving once the ball is this far across the court towards it. */
  patience: number
  /** How often it tries to return off the end of its paddle, for a sharper angle. */
  nerve: number
}

export const PADDLE_SKILL: Record<'easy' | 'normal' | 'hard', PaddleSkill> = {
  easy: { speed: 310, error: 0.16, patience: 0.45, nerve: 0 },
  normal: { speed: 430, error: 0.08, patience: 0.7, nerve: 0.3 },
  hard: { speed: 560, error: 0.035, patience: 0.95, nerve: 0.6 }
}

/**
 * Where the opponent wants its paddle. While the ball is going the other way it drifts back to the middle, which is
 * what a person does; once the ball is on its way it aims at where the ball will arrive, off by `bias` of its error.
 */
export function opponentAim(ball: Ball, lineX: number, skill: PaddleSkill, bias: number, paddleHalf: number, nerveSide = 0): number {
  const middle = COURT.height / 2
  const towards = lineX > ball.x ? ball.vx > 0 : ball.vx < 0
  if (!towards) return middle
  const travelled = 1 - Math.abs(lineX - ball.x) / COURT.width
  if (travelled < 1 - skill.patience) return middle
  const crossing = predictCrossing(ball, lineX, 0, COURT.height)
  if (crossing === null) return middle
  const aim = crossing + bias * skill.error * COURT.height - nerveSide * skill.nerve * paddleHalf
  return clamp(aim, 0, COURT.height)
}

export const WIN_POINTS = 7

export const matchDone = (you: number, them: number): boolean => you >= WIN_POINTS || them >= WIN_POINTS

/** The points for a finished match: what you scored, how long your best rally ran, and winning on top. */
export function duelScore(you: number, them: number, longestRally: number, difficulty: 'easy' | 'normal' | 'hard'): number {
  const weight = difficulty === 'hard' ? 3 : difficulty === 'normal' ? 2 : 1
  return (you * 120 + longestRally * 25 + (you > them ? 600 : 0)) * weight
}
