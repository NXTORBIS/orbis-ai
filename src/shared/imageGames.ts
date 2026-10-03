export const GRID = 24

export type GameId = 'snake' | 'flappy' | '2048' | 'breakout'
export type GameKey = 'up' | 'down' | 'left' | 'right' | 'action'
export type PointerKind = 'down' | 'move' | 'up'

export interface Palette {
  accent: string
  ink: string
  muted: string
  danger: string
  bg: string
}

export interface Game {
  update(dt: number): void
  draw(ctx: CanvasRenderingContext2D, size: number, palette: Palette): void
  key(key: GameKey): void
  /** x and y run 0..1 across the board. */
  pointer(kind: PointerKind, x: number, y: number): void
  score(): number
  /** Shown over the board while the game waits for input. */
  hint(): string | null
}

const rand = (n: number): number => Math.floor(Math.random() * n)
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

function dot(ctx: CanvasRenderingContext2D, size: number, gx: number, gy: number, radius: number, color: string, alpha = 1): void {
  const cell = size / GRID
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc((gx + 0.5) * cell, (gy + 0.5) * cell, radius * cell, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
}

function flash(ctx: CanvasRenderingContext2D, size: number, color: string, amount: number): void {
  if (amount <= 0) return
  ctx.globalAlpha = amount * 0.35
  ctx.fillStyle = color
  ctx.fillRect(0, 0, size, size)
  ctx.globalAlpha = 1
}

export function drawDotGrid(px: number, palette: Palette): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const cell = px / GRID
  ctx.fillStyle = palette.muted
  ctx.globalAlpha = 0.35
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      ctx.beginPath()
      ctx.arc((x + 0.5) * cell, (y + 0.5) * cell, cell * 0.08, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  return canvas
}

function createSnake(): Game {
  type Point = { x: number; y: number }
  let body: Point[] = []
  let dir: Point = { x: 1, y: 0 }
  let queue: Point[] = []
  let food: Point = { x: 0, y: 0 }
  let acc = 0
  let score = 0
  let started = false
  let crash = 0

  const spawn = (): Point => {
    for (;;) {
      const f = { x: rand(GRID), y: rand(GRID) }
      if (!body.some((s) => s.x === f.x && s.y === f.y)) return f
    }
  }
  const reset = (): void => {
    body = [{ x: 9, y: 12 }, { x: 8, y: 12 }, { x: 7, y: 12 }, { x: 6, y: 12 }]
    dir = { x: 1, y: 0 }
    queue = []
    score = 0
    food = spawn()
  }
  const turn = (next: Point): void => {
    started = true
    const last = queue[queue.length - 1] ?? dir
    if ((next.x === -last.x && next.y === -last.y) || (next.x === last.x && next.y === last.y)) return
    if (queue.length < 3) queue.push(next)
  }
  reset()

  return {
    update(dt) {
      crash = Math.max(0, crash - dt)
      if (!started) return
      acc += dt
      const step = Math.max(0.065, 0.12 - score * 0.002)
      while (acc >= step) {
        acc -= step
        dir = queue.shift() ?? dir
        const head = { x: (body[0].x + dir.x + GRID) % GRID, y: (body[0].y + dir.y + GRID) % GRID }
        const eats = head.x === food.x && head.y === food.y
        if ((eats ? body : body.slice(0, -1)).some((s) => s.x === head.x && s.y === head.y)) {
          crash = 0.5
          started = false
          acc = 0
          reset()
          return
        }
        body.unshift(head)
        if (eats) {
          score++
          food = spawn()
        } else {
          body.pop()
        }
      }
    },
    draw(ctx, size, p) {
      dot(ctx, size, food.x, food.y, 0.28 + Math.sin(performance.now() / 180) * 0.05, p.accent)
      body.forEach((s, i) => dot(ctx, size, s.x, s.y, i === 0 ? 0.46 : 0.4, p.accent, i === 0 ? 1 : Math.max(0.35, 1 - i * 0.03)))
      flash(ctx, size, p.danger, crash)
    },
    key(k) {
      if (k === 'up') turn({ x: 0, y: -1 })
      else if (k === 'down') turn({ x: 0, y: 1 })
      else if (k === 'left') turn({ x: -1, y: 0 })
      else if (k === 'right') turn({ x: 1, y: 0 })
      else started = true
    },
    pointer(kind, x, y) {
      if (kind !== 'down') return
      const current = queue[queue.length - 1] ?? dir
      const dx = x * GRID - (body[0].x + 0.5)
      const dy = y * GRID - (body[0].y + 0.5)
      if (current.x !== 0) turn({ x: 0, y: dy < 0 ? -1 : 1 })
      else turn({ x: dx < 0 ? -1 : 1, y: 0 })
    },
    score: () => score,
    hint: () => (started ? null : 'Arrow keys or click to steer')
  }
}

function createFlappy(): Game {
  const BIRD_X = 6
  const GAP = 7
  const SPEED = 7
  const GRAVITY = 60
  const FLAP = -17
  type Pipe = { x: number; gap: number; passed: boolean }
  let y = 11
  let vy = 0
  let pipes: Pipe[] = []
  let score = 0
  let started = false
  let crash = 0
  let t = 0

  const die = (): void => {
    crash = 0.5
    y = 11
    vy = 0
    pipes = []
    score = 0
    started = false
  }
  const flap = (): void => {
    started = true
    vy = FLAP
  }

  return {
    update(dt) {
      t += dt
      crash = Math.max(0, crash - dt)
      if (!started) {
        y = 11 + Math.sin(t * 3) * 0.6
        return
      }
      vy += GRAVITY * dt
      y += vy * dt
      for (const pipe of pipes) pipe.x -= SPEED * dt
      if (!pipes.length || pipes[pipes.length - 1].x < GRID - 10) pipes.push({ x: GRID + 1, gap: 3 + rand(GRID - GAP - 6), passed: false })
      pipes = pipes.filter((pipe) => pipe.x > -2)
      for (const pipe of pipes) {
        if (!pipe.passed && pipe.x < BIRD_X - 0.5) {
          pipe.passed = true
          score++
        }
        if (Math.abs(pipe.x - BIRD_X) < 0.85 && (y < pipe.gap - 0.35 || y > pipe.gap + GAP - 0.65)) return die()
      }
      if (y < -0.5 || y > GRID - 0.5) die()
    },
    draw(ctx, size, p) {
      for (const pipe of pipes) {
        for (let gy = 0; gy < GRID; gy++) if (gy < pipe.gap || gy >= pipe.gap + GAP) dot(ctx, size, pipe.x, gy, 0.38, p.ink, 0.7)
      }
      dot(ctx, size, BIRD_X - 0.75, y + clamp(vy / 50, -0.3, 0.3), 0.3, p.accent, 0.6)
      dot(ctx, size, BIRD_X, y, 0.55, p.accent)
      flash(ctx, size, p.danger, crash)
    },
    key(k) {
      if (k === 'up' || k === 'action') flap()
    },
    pointer(kind) {
      if (kind === 'down') flap()
    },
    score: () => score,
    hint: () => (started ? null : 'Space or click to flap')
  }
}

function create2048(): Game {
  let board: number[] = []
  let score = 0
  let started = false
  let over = false
  let swipe: { x: number; y: number } | null = null

  const add = (): void => {
    const empty = board.flatMap((v, i) => (v ? [] : [i]))
    if (empty.length) board[empty[rand(empty.length)]] = Math.random() < 0.9 ? 2 : 4
  }
  const reset = (): void => {
    board = Array<number>(16).fill(0)
    score = 0
    over = false
    add()
    add()
  }
  const canMove = (): boolean => board.some((v, i) => !v || (i % 4 < 3 && v === board[i + 1]) || (i < 12 && v === board[i + 4]))
  const move = (dx: number, dy: number): void => {
    if (over) return reset()
    started = true
    let moved = false
    for (let line = 0; line < 4; line++) {
      const cells = [0, 1, 2, 3].map((k) => {
        const pos = (dy === 0 ? dx < 0 : dy < 0) ? k : 3 - k
        return dy === 0 ? line * 4 + pos : pos * 4 + line
      })
      const values = cells.map((i) => board[i]).filter(Boolean)
      const merged: number[] = []
      for (let k = 0; k < values.length; k++) {
        if (values[k] === values[k + 1]) {
          merged.push(values[k] * 2)
          score += values[k] * 2
          k++
        } else {
          merged.push(values[k])
        }
      }
      cells.forEach((i, k) => {
        const v = merged[k] ?? 0
        if (board[i] !== v) moved = true
        board[i] = v
      })
    }
    if (moved) add()
    if (!canMove()) over = true
  }
  reset()

  return {
    update() {},
    draw(ctx, size, p) {
      const cell = size / 4
      const pad = size * 0.018
      for (let i = 0; i < 16; i++) {
        const v = board[i]
        const x = (i % 4) * cell + pad
        const y = Math.floor(i / 4) * cell + pad
        const w = cell - pad * 2
        ctx.globalAlpha = v ? Math.min(0.9, 0.16 + Math.log2(v) * 0.07) : 0.06
        ctx.fillStyle = v ? p.accent : p.ink
        ctx.beginPath()
        ctx.roundRect(x, y, w, w, size * 0.03)
        ctx.fill()
        if (!v) continue
        ctx.globalAlpha = 1
        ctx.fillStyle = p.ink
        ctx.font = `600 ${Math.round(w * (v < 100 ? 0.42 : v < 1000 ? 0.34 : 0.26))}px 'Inter Variable', 'Segoe UI', sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(v), x + w / 2, y + w / 2 + 1)
      }
      if (over) {
        ctx.globalAlpha = 0.55
        ctx.fillStyle = p.bg
        ctx.fillRect(0, 0, size, size)
        ctx.globalAlpha = 1
      }
    },
    key(k) {
      if (k === 'left') move(-1, 0)
      else if (k === 'right') move(1, 0)
      else if (k === 'up') move(0, -1)
      else if (k === 'down') move(0, 1)
      else if (over) reset()
    },
    pointer(kind, x, y) {
      if (kind === 'down') swipe = { x, y }
      if (kind !== 'up' || !swipe) return
      const dx = x - swipe.x
      const dy = y - swipe.y
      swipe = null
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 0.06) return
      if (Math.abs(dx) > Math.abs(dy)) move(Math.sign(dx), 0)
      else move(0, Math.sign(dy))
    },
    score: () => score,
    hint: () => (over ? 'No moves left. Press an arrow key to restart' : started ? null : 'Arrow keys or swipe to merge')
  }
}

function createBreakout(): Game {
  const PADDLE_W = 5
  const PADDLE_Y = GRID - 2
  const SPEED = 15
  let paddle = GRID / 2
  let bx = 0
  let by = 0
  let vx = 0
  let vy = 0
  let bricks = new Set<number>()
  let score = 0
  let started = false
  let crash = 0

  const build = (): void => {
    bricks = new Set()
    for (let y = 3; y < 8; y++) for (let x = 1; x < GRID - 1; x++) bricks.add(y * GRID + x)
  }
  const launch = (): void => {
    if (started) return
    started = true
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.8
    vx = Math.cos(angle) * SPEED
    vy = Math.sin(angle) * SPEED
  }
  const movePaddle = (x: number): void => {
    paddle = clamp(x, PADDLE_W / 2 - 0.5, GRID - PADDLE_W / 2 - 0.5)
  }
  build()

  return {
    update(dt) {
      crash = Math.max(0, crash - dt)
      if (!started) {
        bx = paddle
        by = PADDLE_Y - 1
        return
      }
      // Substeps keep the ball from tunnelling through a brick row on slow frames.
      const steps = Math.max(1, Math.ceil((SPEED * dt) / 0.4))
      for (let s = 0; s < steps; s++) {
        bx += (vx * dt) / steps
        by += (vy * dt) / steps
        if (bx < 0) {
          bx = 0
          vx = Math.abs(vx)
        } else if (bx > GRID - 1) {
          bx = GRID - 1
          vx = -Math.abs(vx)
        }
        if (by < 0) {
          by = 0
          vy = Math.abs(vy)
        }
        if (vy > 0 && by >= PADDLE_Y - 1 && by <= PADDLE_Y - 0.2 && Math.abs(bx - paddle) <= PADDLE_W / 2 + 0.3) {
          const angle = -Math.PI / 2 + ((bx - paddle) / (PADDLE_W / 2)) * 1.0
          vx = Math.cos(angle) * SPEED
          vy = Math.sin(angle) * SPEED
          by = PADDLE_Y - 1
        }
        const cell = Math.round(by) * GRID + Math.round(bx)
        if (bricks.has(cell)) {
          bricks.delete(cell)
          score++
          vy = -vy
          if (!bricks.size) build()
          break
        }
        if (by > GRID) {
          crash = 0.5
          score = 0
          started = false
          build()
          return
        }
      }
    },
    draw(ctx, size, p) {
      for (const cell of bricks) {
        const y = Math.floor(cell / GRID)
        dot(ctx, size, cell % GRID, y, 0.36, y % 2 ? p.accent : p.ink, 0.75)
      }
      for (let i = -2; i <= 2; i++) dot(ctx, size, paddle + i, PADDLE_Y, 0.42, p.accent)
      dot(ctx, size, bx, by, 0.42, p.ink)
      flash(ctx, size, p.danger, crash)
    },
    key(k) {
      if (k === 'left') movePaddle(paddle - 2)
      else if (k === 'right') movePaddle(paddle + 2)
      else launch()
    },
    pointer(kind, x) {
      movePaddle(x * GRID - 0.5)
      if (kind === 'down') launch()
    },
    score: () => score,
    hint: () => (started ? null : 'Move the mouse, click to launch')
  }
}

export const GAMES: { id: GameId; label: string; create: () => Game }[] = [
  { id: 'snake', label: 'Snake', create: createSnake },
  { id: 'flappy', label: 'Flappy', create: createFlappy },
  { id: '2048', label: '2048', create: create2048 },
  { id: 'breakout', label: 'Breakout', create: createBreakout }
]
