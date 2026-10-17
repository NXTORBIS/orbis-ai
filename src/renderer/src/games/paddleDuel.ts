import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import { clamp, createLoop, fitCanvas, palette } from './engine'
import type { Ball } from '../../../shared/games/paddleDuel'
import { bounceOffPaddle, COURT, duelScore, matchDone, opponentAim, PADDLE_SKILL, SERVE_SPEED, WIN_POINTS } from '../../../shared/games/paddleDuel'

const BALL_RADIUS = 10
const PADDLE_WIDTH = 16
const YOUR_LINE = 40
const THEIR_LINE = COURT.width - 40
const YOUR_SPEED = 560

/** Your paddle is longer on easy and shorter on hard; theirs is the other way round. */
const PADDLE_HALF = {
  easy: { you: 70, them: 46 },
  normal: { you: 56, them: 56 },
  hard: { you: 46, them: 66 }
}

/**
 * Paddle Duel: first to seven. Where the ball strikes your paddle decides the angle it leaves at — the middle sends
 * it straight back, the ends send it away at up to sixty degrees — and a paddle that is still moving drags the ball a
 * little further round. Every return in a rally is faster than the last, so the rallies that matter are the ones that
 * get away from both of you.
 *
 * The opponent does not track the ball. It reads the angle, works out where the ball will reach its own line with all
 * the bounces folded in, and goes there — with an error it picks at the start of each rally and keeps. That is why it
 * can be beaten: its mistake is in the reading, and a sharp angle makes the reading harder.
 */
function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 760
  let H = 480
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const skill = PADDLE_SKILL[ctx.prefs.difficulty]
  const half = PADDLE_HALF[ctx.prefs.difficulty]

  let status: GameStatus = 'ready'
  let ball: Ball = { x: COURT.width / 2, y: COURT.height / 2, vx: 0, vy: 0 }
  let speed = SERVE_SPEED
  let you = COURT.height / 2
  let them = COURT.height / 2
  let yourLast = you
  let theirLast = them
  let yourPoints = 0
  let theirPoints = 0
  let rally = 0
  let longestRally = 0
  let serveIn = 1.2
  let serveTo: 1 | -1 = 1
  let bias = 0
  let nerveSide = 0
  let trail: { x: number; y: number }[] = []
  let elapsed = 0
  let lastEmit = 0
  let message = ''

  const tally = (): number => duelScore(yourPoints, theirPoints, longestRally, ctx.prefs.difficulty)

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 100) return
    lastEmit = performance.now()
    ctx.emit({
      status,
      score: tally(),
      level: yourPoints + theirPoints + 1,
      elapsedMs: Math.round(elapsed * 1000),
      difficulty: Math.round((speed / SERVE_SPEED) * 100) / 100,
      hud: [
        { label: 'You', value: yourPoints },
        { label: 'Them', value: theirPoints },
        { label: 'Rally', value: rally }
      ]
    })
  }

  /** A new rally: the opponent picks the error it will live with for this one. */
  const serve = (): void => {
    ball = { x: COURT.width / 2, y: COURT.height / 2, vx: 0, vy: 0 }
    speed = SERVE_SPEED
    const angle = (Math.random() - 0.5) * 0.7
    ball.vx = Math.cos(angle) * speed * serveTo
    ball.vy = Math.sin(angle) * speed
    rally = 0
    bias = Math.random() * 2 - 1
    nerveSide = Math.random() < skill.nerve ? (Math.random() < 0.5 ? 1 : -1) : 0
    trail = []
    message = ''
  }

  const reset = (): void => {
    status = 'ready'
    yourPoints = 0
    theirPoints = 0
    rally = 0
    longestRally = 0
    elapsed = 0
    you = COURT.height / 2
    them = COURT.height / 2
    yourLast = you
    theirLast = them
    serveTo = 1
    serveIn = 1.2
    serve()
    message = ''
    emit(true)
  }

  const point = (toYou: boolean): void => {
    longestRally = Math.max(longestRally, rally)
    if (toYou) {
      yourPoints++
      ctx.audio.blip(820, 220, 'triangle')
    } else {
      theirPoints++
      ctx.audio.blip(180, 260, 'sawtooth')
    }
    serveTo = toYou ? 1 : -1
    if (matchDone(yourPoints, theirPoints)) {
      status = 'over'
      message = ''
      emit(true)
      ctx.over({ score: tally(), extra: { difficulty: ctx.prefs.difficulty, bestStreak: longestRally } })
      return
    }
    message = toYou ? 'Your point.' : 'Their point.'
    serveIn = 1.2
    ball = { x: COURT.width / 2, y: COURT.height / 2, vx: 0, vy: 0 }
    emit(true)
  }

  const movePaddles = (dt: number): void => {
    const input = ctx.input
    const keyed = input.down('ArrowUp', 'KeyW') || input.down('ArrowDown', 'KeyS')
    yourLast = you
    if (keyed) {
      if (input.down('ArrowUp', 'KeyW')) you -= YOUR_SPEED * dt
      if (input.down('ArrowDown', 'KeyS')) you += YOUR_SPEED * dt
    } else if (performance.now() - input.pointer.movedAt < 2500) {
      const scale = Math.min(W / COURT.width, H / COURT.height)
      const oy = (H - COURT.height * scale) / 2
      const wanted = (input.pointer.y - oy) / scale
      you += clamp(wanted - you, -YOUR_SPEED * dt, YOUR_SPEED * dt)
    }
    you = clamp(you, half.you, COURT.height - half.you)

    theirLast = them
    const aim = opponentAim(ball, THEIR_LINE, skill, bias, half.them, nerveSide)
    them += clamp(aim - them, -skill.speed * dt, skill.speed * dt)
    them = clamp(them, half.them, COURT.height - half.them)
  }

  const hit = (toRight: boolean, paddleCentre: number, paddleVy: number): void => {
    const bounce = bounceOffPaddle({ ballY: ball.y, paddleCentre, paddleHalf: toRight ? half.you : half.them, speed, toRight, paddleVy })
    ball.vx = bounce.vx
    ball.vy = bounce.vy
    speed = bounce.speed
    rally++
    ctx.audio.blip(360 + Math.min(16, rally) * 24, 50, 'square', 0.6)
  }

  const step = (dt: number): void => {
    const input = ctx.input
    if (status === 'running' && input.pressed('KeyP', 'Enter')) {
      input.endStep()
      return instance.pause()
    }
    if (status === 'ready' && (input.down('ArrowUp', 'ArrowDown', 'KeyW', 'KeyS') || input.pressed('Space') || input.taps > 0 || performance.now() - input.pointer.movedAt < 400)) {
      status = 'running'
      serveIn = 0.8
    }
    if (status !== 'running') return input.endStep()
    elapsed += dt
    movePaddles(dt)
    if (serveIn > 0) {
      serveIn -= dt
      if (serveIn <= 0) serve()
      emit()
      return input.endStep()
    }

    ball.x += ball.vx * dt
    ball.y += ball.vy * dt
    if (!ctx.prefs.reducedMotion) {
      trail.push({ x: ball.x, y: ball.y })
      if (trail.length > 14) trail.shift()
    }
    if (ball.y < BALL_RADIUS && ball.vy < 0) {
      ball.y = BALL_RADIUS
      ball.vy = -ball.vy
      ctx.audio.blip(300, 35, 'sine', 0.4)
    }
    if (ball.y > COURT.height - BALL_RADIUS && ball.vy > 0) {
      ball.y = COURT.height - BALL_RADIUS
      ball.vy = -ball.vy
      ctx.audio.blip(300, 35, 'sine', 0.4)
    }

    const yourFace = YOUR_LINE + PADDLE_WIDTH / 2 + BALL_RADIUS
    if (ball.vx < 0 && ball.x <= yourFace && ball.x > YOUR_LINE - BALL_RADIUS * 2) {
      if (Math.abs(ball.y - you) <= half.you + BALL_RADIUS) {
        ball.x = yourFace
        hit(true, you, (you - yourLast) / dt)
      }
    }
    const theirFace = THEIR_LINE - PADDLE_WIDTH / 2 - BALL_RADIUS
    if (ball.vx > 0 && ball.x >= theirFace && ball.x < THEIR_LINE + BALL_RADIUS * 2) {
      if (Math.abs(ball.y - them) <= half.them + BALL_RADIUS) {
        ball.x = theirFace
        hit(false, them, (them - theirLast) / dt)
      }
    }
    if (ball.x < -BALL_RADIUS * 2) point(false)
    else if (ball.x > COURT.width + BALL_RADIUS * 2) point(true)
    emit()
    input.endStep()
  }

  const draw = (): void => {
    const scale = Math.min(W / COURT.width, H / COURT.height)
    const ox = (W - COURT.width * scale) / 2
    const oy = (H - COURT.height * scale) / 2
    const px = (x: number): number => ox + x * scale
    const py = (y: number): number => oy + y * scale
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)
    g.strokeStyle = colors.bgSoft
    g.lineWidth = 2
    g.strokeRect(ox, oy, COURT.width * scale, COURT.height * scale)
    g.setLineDash([10 * scale, 14 * scale])
    g.beginPath()
    g.moveTo(px(COURT.width / 2), py(0))
    g.lineTo(px(COURT.width / 2), py(COURT.height))
    g.stroke()
    g.setLineDash([])

    g.font = `700 ${Math.round(54 * scale)}px system-ui, sans-serif`
    g.textAlign = 'center'
    g.fillStyle = colors.bgSoft
    g.fillText(String(yourPoints), px(COURT.width / 2 - 90), py(80))
    g.fillText(String(theirPoints), px(COURT.width / 2 + 90), py(80))

    if (!ctx.prefs.reducedMotion)
      trail.forEach((p, i) => {
        g.globalAlpha = (i / trail.length) * 0.4
        g.fillStyle = colors.secondary
        g.beginPath()
        g.arc(px(p.x), py(p.y), BALL_RADIUS * scale * 0.7, 0, Math.PI * 2)
        g.fill()
      })
    g.globalAlpha = 1

    g.fillStyle = colors.primary
    g.beginPath()
    g.roundRect(px(YOUR_LINE - PADDLE_WIDTH / 2), py(you - half.you), PADDLE_WIDTH * scale, half.you * 2 * scale, 6 * scale)
    g.fill()
    g.fillStyle = colors.accent
    g.beginPath()
    g.roundRect(px(THEIR_LINE - PADDLE_WIDTH / 2), py(them - half.them), PADDLE_WIDTH * scale, half.them * 2 * scale, 6 * scale)
    g.fill()

    if (serveIn <= 0 || status === 'over') {
      g.fillStyle = colors.text
      g.beginPath()
      g.arc(px(ball.x), py(ball.y), BALL_RADIUS * scale, 0, Math.PI * 2)
      g.fill()
    }

    g.textAlign = 'center'
    if (status === 'ready') {
      g.fillStyle = colors.text
      g.font = `600 ${Math.round(20 * scale)}px system-ui, sans-serif`
      g.fillText(`First to ${WIN_POINTS}. Up and down, W and S, or move the mouse.`, W / 2, py(COURT.height / 2 - 30))
      g.fillStyle = colors.muted
      g.font = `500 ${Math.round(15 * scale)}px system-ui, sans-serif`
      g.fillText('Hit the ball with the end of your paddle to send it off at an angle.', W / 2, py(COURT.height / 2 + 10))
    } else if (message) {
      g.fillStyle = colors.muted
      g.font = `600 ${Math.round(18 * scale)}px system-ui, sans-serif`
      g.fillText(message, W / 2, py(COURT.height / 2 + 150))
    }
  }

  const loop = createLoop(step, draw)
  const instance: GameInstance = {
    start() {
      reset()
      loop.start()
      ctx.audio.resumeMusic()
    },
    pause() {
      if (status !== 'running') return
      status = 'paused'
      loop.stop()
      ctx.audio.pauseMusic()
      emit(true)
      draw()
    },
    resume() {
      if (status !== 'paused') return
      status = 'running'
      loop.start()
      ctx.audio.resumeMusic()
      emit(true)
    },
    restart() {
      loop.stop()
      reset()
      loop.start()
    },
    destroy() {
      loop.stop()
    },
    resize(width, height) {
      W = width
      H = height
      g = fitCanvas(canvas, width, height)
      draw()
    }
  }
  return instance
}

const paddleDuel: GameModule = { id: 'paddle-duel', surface: 'canvas', create }
export default paddleDuel
