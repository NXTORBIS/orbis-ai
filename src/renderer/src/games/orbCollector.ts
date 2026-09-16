import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import { clamp, createLoop, difficultyFactor, fitCanvas, palette } from './engine'

type ItemKind = 'energy' | 'multiplier' | 'magnet' | 'hazard'

interface Item {
  kind: ItemKind
  x: number
  y: number
  vx: number
  vy: number
  r: number
  life: number
}

/**
 * Orb Collector: guide the Orbis orb around an open field. Energy orbs score (more while a multiplier runs), a magnet
 * pulls energy in, and red hazards drift about, more and faster as time goes on. Three lives; a short safe moment
 * follows each hit.
 */
function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 800
  let H = 500
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const factor = difficultyFactor(ctx.prefs.difficulty)

  let status: GameStatus = 'ready'
  let orb = { x: 0, y: 0, vx: 0, vy: 0 }
  let items: Item[] = []
  let points = 0
  let lives = 3
  let elapsed = 0
  let multiplierLeft = 0
  let magnetLeft = 0
  let safeLeft = 0
  let energyIn = 0
  let hazardIn = 2
  let collected = 0
  let lastEmit = 0

  const R = (): number => Math.max(12, Math.min(W, H) * 0.03)
  const pace = (): number => (1 + elapsed / 40) * factor
  const multiplier = (): number => (multiplierLeft > 0 ? 3 : 1)

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 100) return
    lastEmit = performance.now()
    ctx.emit({ status, score: points, lives, elapsedMs: Math.round(elapsed * 1000), difficulty: Math.round(pace() * 100) / 100, hud: [{ label: 'Multiplier', value: `×${multiplier()}` }, { label: 'Orbs', value: collected }] })
  }

  const reset = (): void => {
    status = 'ready'
    orb = { x: W / 2, y: H / 2, vx: 0, vy: 0 }
    items = []
    points = 0
    lives = 3
    elapsed = 0
    multiplierLeft = magnetLeft = safeLeft = 0
    energyIn = 0
    hazardIn = 2
    collected = 0
    emit(true)
  }

  const placeAway = (min: number): { x: number; y: number } => {
    for (let i = 0; i < 30; i++) {
      const p = { x: 30 + Math.random() * (W - 60), y: 30 + Math.random() * (H - 60) }
      if (Math.hypot(p.x - orb.x, p.y - orb.y) > min) return p
    }
    return { x: 30, y: 30 }
  }

  const step = (dt: number): void => {
    const input = ctx.input
    if (status === 'running' && input.pressed('KeyP', 'Enter')) {
      input.endStep()
      return instance.pause()
    }
    const moveKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']
    if (status === 'ready' && (input.pressed(...moveKeys, 'Space') || input.taps > 0)) status = 'running'
    if (status !== 'running') return input.endStep()

    elapsed += dt
    const r = R()
    const ax = (input.down('ArrowRight', 'KeyD') ? 1 : 0) - (input.down('ArrowLeft', 'KeyA') ? 1 : 0)
    const ay = (input.down('ArrowDown', 'KeyS') ? 1 : 0) - (input.down('ArrowUp', 'KeyW') ? 1 : 0)
    const accel = Math.min(W, H) * 5
    if (ax || ay) {
      const len = Math.hypot(ax, ay)
      orb.vx += (ax / len) * accel * dt
      orb.vy += (ay / len) * accel * dt
    } else if (performance.now() - input.pointer.movedAt < 600 || input.pointer.down) {
      orb.vx += (input.pointer.x - orb.x) * 12 * dt
      orb.vy += (input.pointer.y - orb.y) * 12 * dt
    }
    const drag = Math.pow(0.02, dt)
    orb.vx *= drag
    orb.vy *= drag
    orb.x = clamp(orb.x + orb.vx * dt, r, W - r)
    orb.y = clamp(orb.y + orb.vy * dt, r, H - r)

    multiplierLeft = Math.max(0, multiplierLeft - dt)
    magnetLeft = Math.max(0, magnetLeft - dt)
    safeLeft = Math.max(0, safeLeft - dt)

    energyIn -= dt
    if (energyIn <= 0 && items.filter((i) => i.kind === 'energy').length < 6) {
      const p = placeAway(r * 4)
      items.push({ kind: 'energy', ...p, vx: 0, vy: 0, r: 8, life: 9 })
      energyIn = 0.8
      if (Math.random() < 0.08) items.push({ kind: Math.random() < 0.5 ? 'multiplier' : 'magnet', ...placeAway(r * 5), vx: 0, vy: 0, r: 11, life: 7 })
    }
    hazardIn -= dt
    if (hazardIn <= 0) {
      const p = placeAway(Math.min(W, H) * 0.35)
      const a = Math.random() * Math.PI * 2
      const speed = Math.min(W, H) * 0.18 * pace()
      items.push({ kind: 'hazard', ...p, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 13, life: 14 })
      hazardIn = Math.max(0.9, 4 / pace())
    }

    for (const item of items) {
      item.life -= dt
      if (item.kind === 'hazard') {
        item.x += item.vx * dt
        item.y += item.vy * dt
        if (item.x < item.r || item.x > W - item.r) item.vx = -item.vx
        if (item.y < item.r || item.y > H - item.r) item.vy = -item.vy
      } else if (item.kind === 'energy' && magnetLeft > 0) {
        const d = Math.hypot(orb.x - item.x, orb.y - item.y) || 1
        if (d < Math.min(W, H) * 0.4) {
          item.x += ((orb.x - item.x) / d) * Math.min(W, H) * 0.6 * dt
          item.y += ((orb.y - item.y) / d) * Math.min(W, H) * 0.6 * dt
        }
      }
      if (item.life > 0 && Math.hypot(item.x - orb.x, item.y - orb.y) < item.r + r * 0.85) {
        if (item.kind === 'hazard') {
          if (safeLeft > 0) continue
          lives--
          safeLeft = 1.5
          item.life = 0
          ctx.audio.blip(130, 240, 'sawtooth')
          if (lives <= 0) {
            status = 'over'
            emit(true)
            ctx.over({ score: points })
            return input.endStep()
          }
        } else {
          item.life = 0
          if (item.kind === 'energy') {
            collected++
            points += 10 * multiplier()
            ctx.audio.blip(700 + (collected % 5) * 80, 50, 'sine')
          } else {
            points += 30
            if (item.kind === 'multiplier') multiplierLeft = 8
            else magnetLeft = 8
            ctx.audio.blip(1100, 120, 'triangle')
          }
        }
      }
    }
    items = items.filter((i) => i.life > 0)
    emit()
    input.endStep()
  }

  const draw = (): void => {
    const r = R()
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)
    g.strokeStyle = colors.bgSoft
    g.lineWidth = 1
    for (let x = 0; x < W; x += 40) {
      g.beginPath()
      g.moveTo(x, 0)
      g.lineTo(x, H)
      g.stroke()
    }
    for (let y = 0; y < H; y += 40) {
      g.beginPath()
      g.moveTo(0, y)
      g.lineTo(W, y)
      g.stroke()
    }
    for (const item of items) {
      // Items about to vanish blink (or fade, with reduced motion).
      const ending = item.life < 1.5 && item.kind !== 'hazard'
      g.globalAlpha = ending ? (ctx.prefs.reducedMotion ? 0.5 : Math.floor(item.life * 8) % 2 ? 0.3 : 1) : 1
      g.fillStyle = item.kind === 'energy' ? colors.good : item.kind === 'multiplier' ? colors.warn : item.kind === 'magnet' ? colors.secondary : colors.danger
      g.beginPath()
      g.arc(item.x, item.y, item.r, 0, Math.PI * 2)
      g.fill()
      if (item.kind === 'multiplier' || item.kind === 'magnet') {
        g.fillStyle = colors.bg
        g.font = '700 12px system-ui, sans-serif'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(item.kind === 'multiplier' ? '×3' : 'M', item.x, item.y + 1)
        g.textBaseline = 'alphabetic'
      }
    }
    g.globalAlpha = safeLeft > 0 && !ctx.prefs.reducedMotion && Math.floor(safeLeft * 10) % 2 ? 0.4 : 1
    g.fillStyle = colors.primary
    g.beginPath()
    g.arc(orb.x, orb.y, r, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = colors.text
    g.lineWidth = 2
    g.beginPath()
    g.ellipse(orb.x, orb.y, r * 1.45, r * 0.45, -0.35, 0, Math.PI * 2)
    g.stroke()
    if (magnetLeft > 0) {
      g.strokeStyle = colors.secondary
      g.beginPath()
      g.arc(orb.x, orb.y, Math.min(W, H) * 0.4, 0, Math.PI * 2)
      g.globalAlpha = 0.2
      g.stroke()
    }
    g.globalAlpha = 1
    if (status === 'ready') {
      g.fillStyle = colors.text
      g.font = '600 16px system-ui, sans-serif'
      g.textAlign = 'center'
      g.fillText('Move with the arrows or the mouse to start', W / 2, H * 0.35)
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
      orb.x = clamp(orb.x, R(), W - R())
      orb.y = clamp(orb.y, R(), H - R())
      draw()
    }
  }
  return instance
}

const orbCollector: GameModule = { id: 'orb-collector', surface: 'canvas', create }
export default orbCollector
