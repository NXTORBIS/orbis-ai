import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import { createLoop, difficultyFactor, fitCanvas, palette } from './engine'
import { gameRandom } from './seed'

type Point = { x: number; y: number }

const COLS = 28
const ROWS = 18

/**
 * Snake, with an Orbis look: move on a grid, eat to grow, don't hit the walls, obstacles or yourself. Bites in quick
 * succession build a combo multiplier; golden bites are worth more but vanish; every few bites the snake speeds up and
 * new obstacles appear.
 */
function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 700
  let H = 450
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const factor = difficultyFactor(ctx.prefs.difficulty)

  /*
   * One random source for the whole run, remade whenever a run starts.
   *
   * It cannot be a fresh generator per cell: a seeded generator asked once always answers the same thing, so the food
   * would appear in the same square for ever. One source, asked over and over, is what makes a seeded run a real run.
   */
  let random = gameRandom(ctx)
  let status: GameStatus = 'ready'
  let snake: Point[] = []
  let dir: Point = { x: 1, y: 0 }
  let queued: Point[] = []
  let food: Point = { x: 0, y: 0 }
  let golden: (Point & { left: number }) | null = null
  let obstacles: Point[] = []
  let eaten = 0
  let points = 0
  let combo = 1
  let sinceBite = 99
  let tickAcc = 0
  let elapsed = 0
  let grow = 0
  let lastEmit = 0

  const level = (): number => 1 + Math.floor(eaten / 8)
  const tickMs = (): number => Math.max(55, (135 - eaten * 2.2) / factor)
  const occupied = (p: Point): boolean => snake.some((s) => s.x === p.x && s.y === p.y) || obstacles.some((o) => o.x === p.x && o.y === p.y)
  const freeCell = (): Point => {
    for (let i = 0; i < 500; i++) {
      const p = { x: Math.floor(random() * COLS), y: Math.floor(random() * ROWS) }
      if (!occupied(p) && !(food.x === p.x && food.y === p.y)) return p
    }
    return { x: 0, y: 0 }
  }

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 100) return
    lastEmit = performance.now()
    ctx.emit({ status, score: points, level: level(), elapsedMs: Math.round(elapsed * 1000), difficulty: Math.round((135 / tickMs()) * 100) / 100, hud: [{ label: 'Length', value: snake.length }, { label: 'Combo', value: `×${combo}` }] })
  }

  const reset = (): void => {
    random = gameRandom(ctx)
    status = 'ready'
    snake = [{ x: 8, y: 9 }, { x: 7, y: 9 }, { x: 6, y: 9 }]
    dir = { x: 1, y: 0 }
    queued = []
    obstacles = []
    eaten = 0
    points = 0
    combo = 1
    sinceBite = 99
    tickAcc = 0
    elapsed = 0
    grow = 0
    golden = null
    food = freeCell()
    emit(true)
  }

  const addObstacles = (): void => {
    const head = snake[0]
    for (let n = 0; n < 2 + level(); n++) {
      const p = freeCell()
      // Never right in front of the snake.
      if (Math.abs(p.x - head.x) + Math.abs(p.y - head.y) < 5) continue
      obstacles.push(p)
    }
  }

  const tick = (): void => {
    const next = queued.shift()
    if (next) dir = next
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y }
    const hitsWall = head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS
    const hitsBody = snake.slice(0, grow > 0 ? snake.length : snake.length - 1).some((s) => s.x === head.x && s.y === head.y)
    const hitsObstacle = obstacles.some((o) => o.x === head.x && o.y === head.y)
    if (hitsWall || hitsBody || hitsObstacle) {
      status = 'over'
      ctx.audio.blip(120, 300, 'sawtooth')
      emit(true)
      ctx.over({ score: points, extra: { bestStreak: combo } })
      return
    }
    snake.unshift(head)
    if (grow > 0) grow--
    else snake.pop()
    if (head.x === food.x && head.y === food.y) {
      eaten++
      combo = sinceBite < 3 ? Math.min(5, combo + 1) : 1
      sinceBite = 0
      points += 10 * combo * level()
      grow += 1
      food = freeCell()
      ctx.audio.blip(660 + combo * 60, 60, 'square')
      if (eaten % 7 === 0) golden = { ...freeCell(), left: 5 }
      if (eaten % 8 === 0) {
        addObstacles()
        ctx.audio.blip(990, 120, 'triangle')
      }
    }
    if (golden && head.x === golden.x && head.y === golden.y) {
      points += 50 * level()
      grow += 2
      golden = null
      ctx.audio.blip(1200, 90, 'sine')
    }
  }

  const turn = (x: number, y: number): void => {
    const last = queued.at(-1) ?? dir
    // No reversing onto yourself; up to two turns can be queued between moves.
    if ((last.x === -x && last.y === -y) || (last.x === x && last.y === y) || queued.length >= 2) return
    queued.push({ x, y })
  }

  const step = (dt: number): void => {
    const input = ctx.input
    if (input.pressed('ArrowUp', 'KeyW')) turn(0, -1)
    if (input.pressed('ArrowDown', 'KeyS')) turn(0, 1)
    if (input.pressed('ArrowLeft', 'KeyA')) turn(-1, 0)
    if (input.pressed('ArrowRight', 'KeyD')) turn(1, 0)
    if (status === 'running' && input.pressed('KeyP', 'Enter')) {
      input.endStep()
      return instance.pause()
    }
    if (status === 'ready' && (queued.length || input.pressed('Space') || input.taps > 0)) status = 'running'
    if (status !== 'running') return input.endStep()
    elapsed += dt
    sinceBite += dt
    if (golden) {
      golden.left -= dt
      if (golden.left <= 0) golden = null
    }
    tickAcc += dt * 1000
    while (tickAcc >= tickMs() && status === 'running') {
      tickAcc -= tickMs()
      tick()
    }
    emit()
    input.endStep()
  }

  const draw = (): void => {
    const cell = Math.floor(Math.min(W / COLS, H / ROWS))
    const ox = Math.floor((W - cell * COLS) / 2)
    const oy = Math.floor((H - cell * ROWS) / 2)
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)
    g.fillStyle = colors.bgSoft
    g.fillRect(ox, oy, cell * COLS, cell * ROWS)
    g.strokeStyle = colors.primary
    g.lineWidth = 2
    g.strokeRect(ox - 1, oy - 1, cell * COLS + 2, cell * ROWS + 2)
    g.fillStyle = colors.muted
    for (const o of obstacles) g.fillRect(ox + o.x * cell + 1, oy + o.y * cell + 1, cell - 2, cell - 2)
    const pulse = ctx.prefs.reducedMotion ? 0 : Math.sin(elapsed * 8) * cell * 0.08
    g.fillStyle = colors.accent
    g.beginPath()
    g.arc(ox + food.x * cell + cell / 2, oy + food.y * cell + cell / 2, cell * 0.32 + pulse, 0, Math.PI * 2)
    g.fill()
    if (golden) {
      g.fillStyle = colors.warn
      g.beginPath()
      g.arc(ox + golden.x * cell + cell / 2, oy + golden.y * cell + cell / 2, cell * 0.4, 0, Math.PI * 2)
      g.fill()
    }
    snake.forEach((s, i) => {
      g.fillStyle = i === 0 ? colors.primary : i % 2 ? colors.secondary : colors.good
      g.beginPath()
      g.roundRect(ox + s.x * cell + 1, oy + s.y * cell + 1, cell - 2, cell - 2, i === 0 ? cell * 0.35 : cell * 0.2)
      g.fill()
    })
    if (status === 'ready') {
      g.fillStyle = colors.text
      g.font = '600 16px system-ui, sans-serif'
      g.textAlign = 'center'
      g.fillText('Press an arrow key to start', W / 2, oy + cell * ROWS * 0.35)
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

const snake: GameModule = { id: 'snake', surface: 'canvas', create }
export default snake
