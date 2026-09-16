import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import { circleRect, createLoop, difficultyFactor, fitCanvas, palette } from './engine'

interface Obstacle {
  x: number
  y: number
  w: number
  h: number
  kind: 'crystal' | 'drone'
  counted: boolean
  shape: number[]
}

interface Pickup {
  x: number
  y: number
  taken: boolean
}

/**
 * Orbit Runner: an original endless runner. The Orbis orb rolls along a neon track; crystals rise from the ground and
 * drones patrol above it. Jump (hold for height), collect energy, and survive as the track speeds up. Score comes from
 * distance, obstacles cleared and energy collected.
 */
function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let g = fitCanvas(canvas, 800, 300)
  let W = 800
  let H = 300
  const colors = palette(ctx.prefs.highContrast)
  const factor = difficultyFactor(ctx.prefs.difficulty)

  let status: GameStatus = 'ready'
  let player = { y: 0, vy: 0, onGround: true }
  let obstacles: Obstacle[] = []
  let pickups: Pickup[] = []
  let distance = 0
  let elapsed = 0
  let passed = 0
  let energy = 0
  let spawnIn = 1
  let stars: { x: number; y: number; z: number }[] = []
  let lastEmit = 0

  const ground = (): number => H * 0.8
  const radius = (): number => H * 0.055
  const playerX = (): number => W * 0.16
  const speed = (): number => Math.min(3.2, 1 + elapsed * 0.025) * W * 0.38 * factor
  const score = (): number => Math.floor(distance / 25) + passed * 5 + energy * 25

  const reset = (): void => {
    status = 'ready'
    player = { y: ground(), vy: 0, onGround: true }
    obstacles = []
    pickups = []
    distance = 0
    elapsed = 0
    passed = 0
    energy = 0
    spawnIn = 1
    stars = Array.from({ length: 40 }, () => ({ x: Math.random() * W, y: Math.random() * ground() * 0.9, z: 0.2 + Math.random() * 0.8 }))
    emit(true)
  }

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 100) return
    lastEmit = performance.now()
    ctx.emit({ status, score: score(), elapsedMs: Math.round(elapsed * 1000), difficulty: Math.round((speed() / (W * 0.38 * factor)) * 100) / 100, hud: [{ label: 'Energy', value: energy }] })
  }

  const spawn = (): void => {
    const r = radius()
    const drone = elapsed > 9 && Math.random() < 0.3
    if (drone) {
      const h = r * 1.1
      obstacles.push({ x: W + 20, y: ground() - r * 2.6 - h, w: r * 2.2, h, kind: 'drone', counted: false, shape: [] })
    } else {
      const tall = Math.random() < 0.35 + Math.min(0.3, elapsed / 120)
      const h = r * (tall ? 2.2 : 1.3)
      const w = r * (0.9 + Math.random() * 0.8)
      obstacles.push({ x: W + 20, y: ground() - h, w, h, kind: 'crystal', counted: false, shape: [Math.random(), Math.random(), Math.random()] })
    }
    if (Math.random() < 0.4) pickups.push({ x: W + 20 + r * 4, y: ground() - r * (3.2 + Math.random() * 1.5), taken: false })
    // Gaps shrink with speed but always leave room to land and jump again.
    const minGap = 0.75
    spawnIn = Math.max(minGap, 1.5 - elapsed * 0.012) + Math.random() * 0.7
  }

  const jumpKeys = ['Space', 'ArrowUp', 'KeyW']
  const step = (dt: number): void => {
    const input = ctx.input
    if (status === 'running' && (input.pressed('KeyP') || input.pressed('Enter'))) {
      input.endStep()
      return instance.pause()
    }
    if (status === 'ready' && (input.pressed(...jumpKeys) || input.taps > 0)) status = 'running'
    if (status !== 'running') return input.endStep()

    elapsed += dt
    const v = speed()
    distance += v * dt
    const r = radius()
    if ((input.pressed(...jumpKeys) || input.taps > 0) && player.onGround) {
      player.vy = -H * 2.9
      player.onGround = false
      ctx.audio.blip(520, 70, 'triangle')
    }
    // Holding jump while rising goes higher; letting go falls sooner.
    const holding = input.down(...jumpKeys) || input.pointer.down
    const gravity = H * (player.vy < 0 && holding ? 5.2 : 9.5)
    player.vy += gravity * dt
    player.y += player.vy * dt
    if (player.y >= ground()) {
      player.y = ground()
      player.vy = 0
      player.onGround = true
    }

    spawnIn -= dt
    if (spawnIn <= 0) spawn()
    for (const o of obstacles) {
      o.x -= v * dt
      if (o.kind === 'drone') o.y += Math.sin(elapsed * 4 + o.x * 0.01) * r * 0.6 * dt
      if (!o.counted && o.x + o.w < playerX() - r) {
        o.counted = true
        passed++
      }
      if (circleRect(playerX(), player.y - r, r * 0.86, o.x, o.y, o.w, o.h)) {
        status = 'over'
        ctx.audio.blip(140, 260, 'sawtooth')
        emit(true)
        ctx.over({ score: score() })
        return input.endStep()
      }
    }
    for (const p of pickups) {
      p.x -= v * dt
      if (!p.taken && Math.hypot(p.x - playerX(), p.y - (player.y - r)) < r * 1.4) {
        p.taken = true
        energy++
        ctx.audio.blip(880, 60, 'sine')
      }
    }
    obstacles = obstacles.filter((o) => o.x + o.w > -40)
    pickups = pickups.filter((p) => p.x > -40 && !p.taken)
    if (!ctx.prefs.reducedMotion) for (const s of stars) s.x = (s.x - v * dt * s.z * 0.15 + W) % W
    emit()
    input.endStep()
  }

  const draw = (): void => {
    const r = radius()
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)
    g.fillStyle = colors.muted
    for (const s of stars) g.fillRect(s.x, s.y, s.z * 2, s.z * 2)
    // Track
    g.strokeStyle = colors.primary
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(0, ground() + 1)
    g.lineTo(W, ground() + 1)
    g.stroke()
    g.strokeStyle = colors.bgSoft
    for (let x = -(distance % 40); x < W; x += 40) {
      g.beginPath()
      g.moveTo(x, ground() + 6)
      g.lineTo(x + 18, ground() + 6)
      g.stroke()
    }
    for (const o of obstacles) {
      if (o.kind === 'crystal') {
        g.fillStyle = colors.secondary
        g.beginPath()
        g.moveTo(o.x, o.y + o.h)
        g.lineTo(o.x + o.w * (0.3 + o.shape[0] * 0.2), o.y)
        g.lineTo(o.x + o.w * (0.6 + o.shape[1] * 0.2), o.y + o.h * (0.25 + o.shape[2] * 0.2))
        g.lineTo(o.x + o.w, o.y + o.h)
        g.closePath()
        g.fill()
      } else {
        g.fillStyle = colors.accent
        g.beginPath()
        g.roundRect(o.x, o.y, o.w, o.h, 6)
        g.fill()
        g.fillStyle = Math.floor(elapsed * 6) % 2 && !ctx.prefs.reducedMotion ? colors.warn : colors.bg
        g.fillRect(o.x + o.w / 2 - 3, o.y + o.h / 2 - 3, 6, 6)
      }
    }
    g.fillStyle = colors.good
    for (const p of pickups) {
      g.beginPath()
      g.moveTo(p.x, p.y - r * 0.5)
      g.lineTo(p.x + r * 0.35, p.y)
      g.lineTo(p.x, p.y + r * 0.5)
      g.lineTo(p.x - r * 0.35, p.y)
      g.closePath()
      g.fill()
    }
    // The orb
    const px = playerX()
    const py = player.y - r
    g.fillStyle = colors.primary
    g.beginPath()
    g.arc(px, py, r, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = colors.text
    g.lineWidth = 2
    g.beginPath()
    g.ellipse(px, py, r * 1.45, r * 0.45, -0.35, 0, Math.PI * 2)
    g.stroke()
    if (status === 'ready') {
      g.fillStyle = colors.text
      g.font = '600 16px system-ui, sans-serif'
      g.textAlign = 'center'
      g.fillText('Press Space or tap to start', W / 2, H * 0.4)
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
      if (player.onGround) player.y = ground()
      draw()
    }
  }
  return instance
}

const runner: GameModule = { id: 'runner', surface: 'canvas', create }
export default runner
