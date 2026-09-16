import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import { circleRect, createLoop, difficultyFactor, fitCanvas, palette } from './engine'

interface Gate {
  x: number
  gapY: number
  gap: number
  passed: boolean
}

/**
 * Glide: a one-button game with an original look. The orb rises with each press and falls under gravity; fly through
 * the gaps between energy pillars. Gaps narrow and pillars come faster as the score climbs.
 */
function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 480
  let H = 600
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const factor = difficultyFactor(ctx.prefs.difficulty)

  let status: GameStatus = 'ready'
  let bird = { y: 0, vy: 0 }
  let gates: Gate[] = []
  let points = 0
  let elapsed = 0
  let nextGateIn = 0
  let lastEmit = 0

  const X = (): number => W * 0.28
  const R = (): number => Math.max(11, H * 0.022)
  const pillarW = (): number => Math.max(52, W * 0.12)
  const speed = (): number => W * (0.42 + Math.min(0.35, points * 0.012)) * factor

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 100) return
    lastEmit = performance.now()
    ctx.emit({ status, score: points, elapsedMs: Math.round(elapsed * 1000), difficulty: Math.round((speed() / (W * 0.42 * factor)) * 100) / 100 })
  }

  const reset = (): void => {
    status = 'ready'
    bird = { y: H * 0.45, vy: 0 }
    gates = []
    points = 0
    elapsed = 0
    nextGateIn = 0
    emit(true)
  }

  const flap = (): void => {
    bird.vy = -H * 0.72
    ctx.audio.blip(600, 50, 'triangle', 0.6)
  }

  const step = (dt: number): void => {
    const input = ctx.input
    const pressed = input.pressed('Space', 'ArrowUp', 'KeyW') || input.taps > 0
    if (status === 'running' && input.pressed('KeyP', 'Enter')) {
      input.endStep()
      return instance.pause()
    }
    if (status === 'ready') {
      if (pressed) {
        status = 'running'
        flap()
      }
      return input.endStep()
    }
    if (status !== 'running') return input.endStep()

    elapsed += dt
    if (pressed) flap()
    bird.vy = Math.min(H * 1.1, bird.vy + H * 2.1 * dt)
    bird.y += bird.vy * dt

    nextGateIn -= dt
    if (nextGateIn <= 0) {
      const gap = Math.max(H * 0.22, H * (0.34 - points * 0.004) / factor)
      const margin = H * 0.08
      gates.push({ x: W + 10, gapY: margin + gap / 2 + Math.random() * (H - margin * 2 - gap), gap, passed: false })
      nextGateIn = Math.max(1.05, 1.6 - points * 0.01)
    }
    const r = R()
    for (const gate of gates) {
      gate.x -= speed() * dt
      if (!gate.passed && gate.x + pillarW() < X() - r) {
        gate.passed = true
        points++
        ctx.audio.blip(900, 60, 'sine')
      }
      const top = gate.gapY - gate.gap / 2
      const bottom = gate.gapY + gate.gap / 2
      if (circleRect(X(), bird.y, r * 0.85, gate.x, 0, pillarW(), top) || circleRect(X(), bird.y, r * 0.85, gate.x, bottom, pillarW(), H - bottom)) return end()
    }
    if (bird.y + r > H || bird.y - r < 0) return end()
    gates = gates.filter((gate) => gate.x + pillarW() > -10)
    emit()
    input.endStep()

    function end(): void {
      status = 'over'
      ctx.audio.blip(140, 260, 'sawtooth')
      emit(true)
      ctx.over({ score: points })
      input.endStep()
    }
  }

  const draw = (): void => {
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)
    for (const gate of gates) {
      const top = gate.gapY - gate.gap / 2
      const bottom = gate.gapY + gate.gap / 2
      g.fillStyle = colors.bgSoft
      g.fillRect(gate.x, 0, pillarW(), top)
      g.fillRect(gate.x, bottom, pillarW(), H - bottom)
      g.fillStyle = colors.secondary
      g.fillRect(gate.x - 4, top - 10, pillarW() + 8, 10)
      g.fillRect(gate.x - 4, bottom, pillarW() + 8, 10)
    }
    const r = R()
    const tilt = ctx.prefs.reducedMotion ? 0 : Math.max(-0.5, Math.min(0.9, bird.vy / H))
    g.save()
    g.translate(X(), bird.y)
    g.rotate(tilt)
    g.fillStyle = colors.primary
    g.beginPath()
    g.arc(0, 0, r, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = colors.text
    g.beginPath()
    g.moveTo(-r * 0.2, -r * 0.1)
    g.lineTo(-r * 1.4, -r * 0.7)
    g.lineTo(-r * 1.0, r * 0.2)
    g.closePath()
    g.fill()
    g.restore()
    g.fillStyle = colors.text
    g.font = '700 36px system-ui, sans-serif'
    g.textAlign = 'center'
    if (status !== 'ready') g.fillText(String(points), W / 2, 60)
    else {
      g.font = '600 16px system-ui, sans-serif'
      g.fillText('Press Space or click to rise', W / 2, H * 0.3)
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
      const sy = height / H
      W = width
      H = height
      g = fitCanvas(canvas, width, height)
      bird.y *= sy
      for (const gate of gates) {
        gate.gapY *= sy
        gate.gap *= sy
      }
      draw()
    }
  }
  return instance
}

const flappy: GameModule = { id: 'flappy', surface: 'canvas', create }
export default flappy
