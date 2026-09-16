import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import { clamp, createLoop, difficultyFactor, fitCanvas, palette } from './engine'

interface Hazard {
  kind: 'asteroid' | 'comet' | 'mine'
  x: number
  y: number
  vx: number
  vy: number
  r: number
  angle: number
  spin: number
  shape: number[]
  phase: number
}

interface Cell {
  x: number
  y: number
  vy: number
}

/**
 * Space Dodger: steer a small craft through asteroid fields, streaking comets and drifting mines. Energy cells add
 * points and charge a shield that absorbs one hit. Spawns thicken and hazards speed up over time.
 */
function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 800
  let H = 500
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const factor = difficultyFactor(ctx.prefs.difficulty)

  let status: GameStatus = 'ready'
  let ship = { x: 0, vx: 0 }
  let hazards: Hazard[] = []
  let cells: Cell[] = []
  let elapsed = 0
  let energy = 0
  let shield = 0
  let invulnerable = 0
  let spawnIn = 0.6
  let cellIn = 3
  let lastEmit = 0

  const shipY = (): number => H - Math.max(40, H * 0.1)
  const shipR = (): number => Math.max(12, Math.min(W, H) * 0.028)
  const intensity = (): number => (1 + elapsed / 25) * factor
  const score = (): number => Math.floor(elapsed * 10) + energy * 50

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 100) return
    lastEmit = performance.now()
    ctx.emit({ status, score: score(), elapsedMs: Math.round(elapsed * 1000), difficulty: Math.round(intensity() * 100) / 100, hud: [{ label: 'Shield', value: shield }, { label: 'Energy', value: energy }] })
  }

  const reset = (): void => {
    status = 'ready'
    ship = { x: W / 2, vx: 0 }
    hazards = []
    cells = []
    elapsed = 0
    energy = 0
    shield = 0
    invulnerable = 0
    spawnIn = 0.6
    cellIn = 3
    emit(true)
  }

  const spawn = (): void => {
    const k = intensity()
    const roll = Math.random()
    if (roll < 0.15 && elapsed > 12) {
      const fromLeft = Math.random() < 0.5
      hazards.push({ kind: 'comet', x: fromLeft ? -20 : W + 20, y: Math.random() * H * 0.5, vx: (fromLeft ? 1 : -1) * W * 0.55 * k, vy: H * 0.45 * k, r: 6, angle: 0, spin: 0, shape: [], phase: 0 })
    } else if (roll < 0.28 && elapsed > 6) {
      hazards.push({ kind: 'mine', x: 30 + Math.random() * (W - 60), y: -20, vx: 0, vy: H * 0.16 * k, r: 11, angle: 0, spin: 0, shape: [], phase: Math.random() * 6 })
    } else {
      const r = 10 + Math.random() * 26
      hazards.push({ kind: 'asteroid', x: Math.random() * W, y: -r, vx: (Math.random() - 0.5) * W * 0.08, vy: H * (0.22 + Math.random() * 0.25) * k, r, angle: 0, spin: (Math.random() - 0.5) * 2, shape: Array.from({ length: 9 }, () => 0.75 + Math.random() * 0.35), phase: 0 })
    }
    spawnIn = Math.max(0.12, 0.7 / k) * (0.6 + Math.random() * 0.8)
  }

  const step = (dt: number): void => {
    const input = ctx.input
    if (status === 'running' && input.pressed('KeyP', 'Enter')) {
      input.endStep()
      return instance.pause()
    }
    if (status === 'ready' && (input.pressed('Space', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD') || input.taps > 0)) status = 'running'
    if (status !== 'running') return input.endStep()

    elapsed += dt
    const r = shipR()
    // Keyboard steers with momentum; a recently moved mouse is followed directly.
    const dir = (input.down('ArrowRight', 'KeyD') ? 1 : 0) - (input.down('ArrowLeft', 'KeyA') ? 1 : 0)
    if (dir) ship.vx = clamp(ship.vx + dir * W * 4 * dt, -W * 0.9, W * 0.9)
    else ship.vx *= Math.pow(0.0005, dt)
    if (!dir && performance.now() - input.pointer.movedAt < 400) ship.x += (clamp(input.pointer.x, r, W - r) - ship.x) * Math.min(1, dt * 14)
    else ship.x += ship.vx * dt
    ship.x = clamp(ship.x, r, W - r)

    spawnIn -= dt
    if (spawnIn <= 0) spawn()
    cellIn -= dt
    if (cellIn <= 0) {
      cells.push({ x: 20 + Math.random() * (W - 40), y: -12, vy: H * 0.2 })
      cellIn = 4 + Math.random() * 4
    }
    invulnerable = Math.max(0, invulnerable - dt)

    for (const h of hazards) {
      h.phase += dt
      h.x += (h.kind === 'mine' ? Math.sin(h.phase * 2) * W * 0.12 : h.vx) * dt
      h.y += h.vy * dt
      h.angle += h.spin * dt
      if (invulnerable <= 0 && Math.hypot(h.x - ship.x, h.y - shipY()) < h.r * 0.85 + r * 0.8) {
        if (shield > 0) {
          shield--
          invulnerable = 1.2
          h.y = H + 100
          ctx.audio.blip(300, 120, 'triangle')
        } else {
          status = 'over'
          ctx.audio.blip(110, 320, 'sawtooth')
          emit(true)
          ctx.over({ score: score() })
          return input.endStep()
        }
      }
    }
    for (const c of cells) {
      c.y += c.vy * dt
      if (Math.hypot(c.x - ship.x, c.y - shipY()) < r + 12) {
        c.y = H + 100
        energy++
        shield = Math.min(3, shield + 1)
        ctx.audio.blip(990, 80, 'sine')
      }
    }
    hazards = hazards.filter((h) => h.y < H + 60 && h.x > -80 && h.x < W + 80)
    cells = cells.filter((c) => c.y < H + 40)
    emit()
    input.endStep()
  }

  const draw = (): void => {
    const r = shipR()
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)
    for (const h of hazards) {
      g.save()
      g.translate(h.x, h.y)
      if (h.kind === 'asteroid') {
        g.rotate(h.angle)
        g.fillStyle = colors.muted
        g.beginPath()
        h.shape.forEach((s, i) => {
          const a = (i / h.shape.length) * Math.PI * 2
          const px = Math.cos(a) * h.r * s
          const py = Math.sin(a) * h.r * s
          if (i === 0) g.moveTo(px, py)
          else g.lineTo(px, py)
        })
        g.closePath()
        g.fill()
      } else if (h.kind === 'comet') {
        g.strokeStyle = colors.warn
        g.lineWidth = 3
        g.beginPath()
        g.moveTo(0, 0)
        g.lineTo(-h.vx * 0.05, -h.vy * 0.05)
        g.stroke()
        g.fillStyle = colors.text
        g.beginPath()
        g.arc(0, 0, h.r, 0, Math.PI * 2)
        g.fill()
      } else {
        g.fillStyle = colors.danger
        g.beginPath()
        g.arc(0, 0, h.r, 0, Math.PI * 2)
        g.fill()
        g.strokeStyle = colors.danger
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + h.phase
          g.beginPath()
          g.moveTo(Math.cos(a) * h.r, Math.sin(a) * h.r)
          g.lineTo(Math.cos(a) * h.r * 1.5, Math.sin(a) * h.r * 1.5)
          g.stroke()
        }
      }
      g.restore()
    }
    g.fillStyle = colors.good
    for (const c of cells) {
      g.beginPath()
      g.roundRect(c.x - 6, c.y - 9, 12, 18, 3)
      g.fill()
    }
    // The craft
    const y = shipY()
    const flicker = invulnerable > 0 && !ctx.prefs.reducedMotion && Math.floor(invulnerable * 12) % 2 === 0
    if (!flicker) {
      g.fillStyle = colors.primary
      g.beginPath()
      g.moveTo(ship.x, y - r * 1.3)
      g.lineTo(ship.x + r, y + r * 0.9)
      g.lineTo(ship.x, y + r * 0.45)
      g.lineTo(ship.x - r, y + r * 0.9)
      g.closePath()
      g.fill()
    }
    if (shield > 0) {
      g.strokeStyle = colors.good
      g.lineWidth = 1 + shield
      g.beginPath()
      g.arc(ship.x, y, r * 1.7, 0, Math.PI * 2)
      g.stroke()
    }
    if (status === 'ready') {
      g.fillStyle = colors.text
      g.font = '600 16px system-ui, sans-serif'
      g.textAlign = 'center'
      g.fillText('Press ← → or Space to start', W / 2, H * 0.45)
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
      ship.x = clamp(ship.x, shipR(), W - shipR())
      draw()
    }
  }
  return instance
}

const spaceDodger: GameModule = { id: 'space-dodger', surface: 'canvas', create }
export default spaceDodger
