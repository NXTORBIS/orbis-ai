import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import { circleRect, clamp, createLoop, difficultyFactor, fitCanvas, palette, seeded } from './engine'

interface Ball {
  x: number
  y: number
  vx: number
  vy: number
  stuck: boolean
}

interface Brick {
  x: number
  y: number
  w: number
  h: number
  hp: number
  maxHp: number
}

type PowerKind = 'multi' | 'wide' | 'slow' | 'life' | 'fire'

interface Power {
  kind: PowerKind
  x: number
  y: number
}

const LAYOUTS = ['full', 'checker', 'pyramid', 'diamond', 'stripes', 'fortress'] as const

/**
 * Block Breaker: bounce the ball off the paddle to break every block. Levels change layout and get faster; tougher blocks
 * take several hits. Power-ups drop from broken blocks: multi-ball, a wider paddle, a slower ball, an extra life and a
 * fireball that burns straight through.
 */
function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 700
  let H = 520
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const factor = difficultyFactor(ctx.prefs.difficulty)

  let status: GameStatus = 'ready'
  let paddle = { x: 0, w: 0 }
  let balls: Ball[] = []
  let bricks: Brick[] = []
  let powers: Power[] = []
  let level = 1
  let lives = 3
  let points = 0
  let elapsed = 0
  let wideLeft = 0
  let slowLeft = 0
  let fireLeft = 0
  let lastEmit = 0

  const ballR = (): number => Math.max(5, W * 0.009)
  const paddleY = (): number => H - 34
  const baseSpeed = (): number => H * (0.62 + level * 0.05) * factor * (slowLeft > 0 ? 0.65 : 1)
  const paddleW = (): number => W * (wideLeft > 0 ? 0.22 : 0.14)

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 100) return
    lastEmit = performance.now()
    ctx.emit({ status, score: points, level, lives, elapsedMs: Math.round(elapsed * 1000), difficulty: Math.round((baseSpeed() / (H * 0.67)) * 100) / 100, hud: [{ label: 'Blocks', value: bricks.length }] })
  }

  const buildLevel = (): void => {
    const random = seeded(level * 7919)
    const layout = LAYOUTS[(level - 1) % LAYOUTS.length]
    const cols = 12
    const rows = Math.min(4 + level, 9)
    const gap = 4
    const bw = (W - 40 - gap * (cols - 1)) / cols
    const bh = Math.max(14, H * 0.035)
    bricks = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const mid = (cols - 1) / 2
        const keep =
          layout === 'full' ||
          (layout === 'checker' && (r + c) % 2 === 0) ||
          (layout === 'pyramid' && Math.abs(c - mid) <= r + 0.5) ||
          (layout === 'diamond' && Math.abs(c - mid) + Math.abs(r - rows / 2) <= rows / 2 + 1) ||
          (layout === 'stripes' && r % 2 === 0) ||
          (layout === 'fortress' && (r === 0 || c === 0 || c === cols - 1 || (r > 1 && c > 2 && c < cols - 3)))
        if (!keep) continue
        const hp = 1 + (random() < Math.min(0.5, level * 0.08) ? 1 : 0) + (level > 4 && random() < 0.15 ? 1 : 0)
        bricks.push({ x: 20 + c * (bw + gap), y: 60 + r * (bh + gap), w: bw, h: bh, hp, maxHp: hp })
      }
    }
  }

  const serve = (): void => {
    balls = [{ x: paddle.x, y: paddleY() - ballR() - 1, vx: 0, vy: 0, stuck: true }]
  }

  const reset = (): void => {
    status = 'ready'
    level = 1
    lives = 3
    points = 0
    elapsed = 0
    wideLeft = slowLeft = fireLeft = 0
    powers = []
    paddle = { x: W / 2, w: paddleW() }
    buildLevel()
    serve()
    emit(true)
  }

  const launch = (ball: Ball): void => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.6
    ball.vx = Math.cos(angle) * baseSpeed()
    ball.vy = Math.sin(angle) * baseSpeed()
    ball.stuck = false
  }

  const setSpeed = (ball: Ball, speed: number): void => {
    const current = Math.hypot(ball.vx, ball.vy) || 1
    ball.vx = (ball.vx / current) * speed
    ball.vy = (ball.vy / current) * speed
  }

  const applyPower = (kind: PowerKind): void => {
    points += 25
    ctx.audio.blip(1040, 90, 'sine')
    if (kind === 'multi') {
      const extra: Ball[] = []
      for (const b of balls.filter((x) => !x.stuck).slice(0, 3)) {
        for (const turn of [-0.35, 0.35]) {
          const a = Math.atan2(b.vy, b.vx) + turn
          const s = Math.hypot(b.vx, b.vy)
          extra.push({ x: b.x, y: b.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, stuck: false })
        }
      }
      balls.push(...extra)
    } else if (kind === 'wide') wideLeft = 12
    else if (kind === 'slow') {
      slowLeft = 10
      for (const b of balls) if (!b.stuck) setSpeed(b, baseSpeed())
    } else if (kind === 'life') lives = Math.min(6, lives + 1)
    else fireLeft = 8
  }

  const step = (dt: number): void => {
    const input = ctx.input
    if (status === 'running' && input.pressed('KeyP', 'Enter')) {
      input.endStep()
      return instance.pause()
    }
    if (status === 'ready' && (input.pressed('Space', 'ArrowLeft', 'ArrowRight') || input.taps > 0)) status = 'running'
    if (status !== 'running') return input.endStep()
    elapsed += dt
    wideLeft = Math.max(0, wideLeft - dt)
    const wasSlow = slowLeft > 0
    slowLeft = Math.max(0, slowLeft - dt)
    if (wasSlow && slowLeft === 0) for (const b of balls) if (!b.stuck) setSpeed(b, baseSpeed())
    fireLeft = Math.max(0, fireLeft - dt)
    paddle.w += (paddleW() - paddle.w) * Math.min(1, dt * 8)

    const dir = (input.down('ArrowRight', 'KeyD') ? 1 : 0) - (input.down('ArrowLeft', 'KeyA') ? 1 : 0)
    if (dir) paddle.x += dir * W * 1.2 * dt
    else if (performance.now() - input.pointer.movedAt < 500) paddle.x = input.pointer.x
    paddle.x = clamp(paddle.x, paddle.w / 2, W - paddle.w / 2)
    if (input.pressed('Space') || input.taps > 0) for (const b of balls) if (b.stuck) launch(b)

    const r = ballR()
    for (const ball of balls) {
      if (ball.stuck) {
        ball.x = paddle.x
        ball.y = paddleY() - r - 1
        continue
      }
      ball.x += ball.vx * dt
      ball.y += ball.vy * dt
      if (ball.x < r) ((ball.x = r), (ball.vx = Math.abs(ball.vx)))
      if (ball.x > W - r) ((ball.x = W - r), (ball.vx = -Math.abs(ball.vx)))
      if (ball.y < r) ((ball.y = r), (ball.vy = Math.abs(ball.vy)))
      // Paddle: the further from the centre it hits, the sharper the bounce.
      if (ball.vy > 0 && circleRect(ball.x, ball.y, r, paddle.x - paddle.w / 2, paddleY(), paddle.w, 10)) {
        const offset = clamp((ball.x - paddle.x) / (paddle.w / 2), -1, 1)
        const angle = -Math.PI / 2 + offset * 1.05
        const speed = Math.hypot(ball.vx, ball.vy)
        ball.vx = Math.cos(angle) * speed
        ball.vy = Math.sin(angle) * speed
        ball.y = paddleY() - r - 1
        ctx.audio.blip(330, 40, 'square', 0.6)
      }
      for (const brick of bricks) {
        if (brick.hp <= 0 || !circleRect(ball.x, ball.y, r, brick.x, brick.y, brick.w, brick.h)) continue
        brick.hp -= fireLeft > 0 ? brick.hp : 1
        if (fireLeft <= 0) {
          // Bounce off the side it hit (the axis of least overlap).
          const overlapX = Math.min(ball.x + r - brick.x, brick.x + brick.w - (ball.x - r))
          const overlapY = Math.min(ball.y + r - brick.y, brick.y + brick.h - (ball.y - r))
          if (overlapX < overlapY) ball.vx = -ball.vx
          else ball.vy = -ball.vy
        }
        if (brick.hp <= 0) {
          points += 10 * brick.maxHp * level
          ctx.audio.blip(520 + brick.maxHp * 120, 50, 'triangle', 0.7)
          if (Math.random() < 0.12) powers.push({ kind: (['multi', 'wide', 'slow', 'life', 'fire'] as const)[Math.floor(Math.random() * 5)], x: brick.x + brick.w / 2, y: brick.y + brick.h / 2 })
        } else ctx.audio.blip(260, 40, 'square', 0.5)
        if (fireLeft <= 0) break
      }
    }
    bricks = bricks.filter((b) => b.hp > 0)
    balls = balls.filter((b) => b.y < H + r * 2)

    for (const p of powers) p.y += H * 0.28 * dt
    for (const p of powers) {
      if (p.y > paddleY() - 6 && p.y < paddleY() + 14 && Math.abs(p.x - paddle.x) < paddle.w / 2 + 8) {
        p.y = H + 100
        applyPower(p.kind)
      }
    }
    powers = powers.filter((p) => p.y < H + 20)

    if (!balls.length) {
      lives--
      ctx.audio.blip(150, 220, 'sawtooth')
      if (lives <= 0) {
        status = 'over'
        emit(true)
        ctx.over({ score: points, extra: { difficulty: `level ${level}` } })
        return input.endStep()
      }
      wideLeft = fireLeft = 0
      serve()
    }
    if (!bricks.length) {
      level++
      points += 100 * level
      ctx.audio.blip(880, 200, 'sine')
      powers = []
      buildLevel()
      serve()
    }
    emit()
    input.endStep()
  }

  const POWER_COLORS: Record<PowerKind, string> = { multi: colors.primary, wide: colors.good, slow: colors.secondary, life: colors.accent, fire: colors.warn }
  const POWER_LETTER: Record<PowerKind, string> = { multi: 'M', wide: 'W', slow: 'S', life: '+', fire: 'F' }

  const draw = (): void => {
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)
    for (const b of bricks) {
      g.fillStyle = b.maxHp === 1 ? colors.primary : b.maxHp === 2 ? colors.secondary : colors.accent
      g.globalAlpha = 0.45 + 0.55 * (b.hp / b.maxHp)
      g.beginPath()
      g.roundRect(b.x, b.y, b.w, b.h, 3)
      g.fill()
    }
    g.globalAlpha = 1
    g.font = '700 11px system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    for (const p of powers) {
      g.fillStyle = POWER_COLORS[p.kind]
      g.beginPath()
      g.roundRect(p.x - 12, p.y - 8, 24, 16, 8)
      g.fill()
      g.fillStyle = colors.bg
      g.fillText(POWER_LETTER[p.kind], p.x, p.y + 1)
    }
    g.fillStyle = wideLeft > 0 ? colors.good : colors.text
    g.beginPath()
    g.roundRect(paddle.x - paddle.w / 2, paddleY(), paddle.w, 10, 5)
    g.fill()
    const r = ballR()
    g.fillStyle = fireLeft > 0 ? colors.warn : colors.text
    for (const b of balls) {
      g.beginPath()
      g.arc(b.x, b.y, r, 0, Math.PI * 2)
      g.fill()
    }
    if (status === 'ready') {
      g.fillStyle = colors.text
      g.font = '600 16px system-ui, sans-serif'
      g.fillText('Press Space or click to launch', W / 2, H * 0.6)
    }
    g.textBaseline = 'alphabetic'
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
      const sx = width / W
      W = width
      H = height
      g = fitCanvas(canvas, width, height)
      paddle.x *= sx
      // Blocks keep their layout for the new size.
      if (status === 'ready') buildLevel()
      draw()
    }
  }
  return instance
}

const blockBreaker: GameModule = { id: 'block-breaker', surface: 'canvas', create }
export default blockBreaker
