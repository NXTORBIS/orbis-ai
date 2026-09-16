import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import { circleRect, clamp, createLoop, difficultyFactor, fitCanvas, palette } from './engine'

interface Enemy {
  x: number
  y: number
  w: number
  h: number
  hp: number
  kind: 'scout' | 'striker' | 'boss'
  phase: number
  cooldown: number
}

interface Shot {
  x: number
  y: number
  vx: number
  vy: number
  enemy: boolean
}

interface Drop {
  x: number
  y: number
  kind: 'rapid' | 'spread' | 'shield'
}

/**
 * Star Sentinel: an original wave shooter. Enemy formations sweep in and fire back; every fifth wave brings a boss with
 * its own health bar. Power-ups give rapid fire, a spread shot or a shield. Three lives.
 */
function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 700
  let H = 560
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const factor = difficultyFactor(ctx.prefs.difficulty)

  let status: GameStatus = 'ready'
  let ship = { x: 0 }
  let enemies: Enemy[] = []
  let shots: Shot[] = []
  let drops: Drop[] = []
  let wave = 0
  let points = 0
  let lives = 3
  let elapsed = 0
  let fireCooldown = 0
  let rapidLeft = 0
  let spreadLeft = 0
  let shield = false
  let safeLeft = 0
  let nextWaveIn = 0
  let lastEmit = 0

  const shipY = (): number => H - 44
  const bossHp = (): number => enemies.find((e) => e.kind === 'boss')?.hp ?? 0

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 100) return
    lastEmit = performance.now()
    const hud: { label: string; value: string | number }[] = [{ label: 'Wave', value: wave }]
    if (bossHp()) hud.push({ label: 'Boss', value: bossHp() })
    ctx.emit({ status, score: points, level: wave, lives, elapsedMs: Math.round(elapsed * 1000), difficulty: Math.round((1 + wave * 0.12) * factor * 100) / 100, hud })
  }

  const spawnWave = (): void => {
    wave++
    if (wave % 5 === 0) {
      enemies.push({ x: W / 2 - 60, y: -90, w: 120, h: 60, hp: Math.round((30 + wave * 6) * factor), kind: 'boss', phase: 0, cooldown: 1 })
      ctx.audio.blip(160, 400, 'sawtooth')
      return
    }
    const rows = Math.min(2 + Math.floor(wave / 2), 5)
    const cols = Math.min(6 + Math.floor(wave / 3), 9)
    const gap = (W - 80) / cols
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const striker = r === 0 && wave > 2
        enemies.push({ x: 40 + c * gap + gap * 0.15, y: -40 - r * 42, w: gap * 0.7, h: 26, hp: striker ? 2 : 1, kind: striker ? 'striker' : 'scout', phase: c * 0.4, cooldown: 1 + Math.random() * 3 })
      }
    }
  }

  const reset = (): void => {
    status = 'ready'
    ship = { x: W / 2 }
    enemies = []
    shots = []
    drops = []
    wave = 0
    points = 0
    lives = 3
    elapsed = 0
    fireCooldown = rapidLeft = spreadLeft = safeLeft = 0
    shield = false
    nextWaveIn = 0.5
    emit(true)
  }

  const hitShip = (): boolean => {
    if (safeLeft > 0) return false
    if (shield) {
      shield = false
      safeLeft = 1
      ctx.audio.blip(300, 120, 'triangle')
      return false
    }
    lives--
    safeLeft = 2
    ctx.audio.blip(120, 300, 'sawtooth')
    if (lives > 0) return false
    status = 'over'
    emit(true)
    ctx.over({ score: points, extra: { difficulty: `wave ${wave}` } })
    return true
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
    const speed = (1 + wave * 0.1) * factor
    const dir = (input.down('ArrowRight', 'KeyD') ? 1 : 0) - (input.down('ArrowLeft', 'KeyA') ? 1 : 0)
    if (dir) ship.x += dir * W * 0.9 * dt
    else if (performance.now() - input.pointer.movedAt < 500) ship.x += (input.pointer.x - ship.x) * Math.min(1, dt * 15)
    ship.x = clamp(ship.x, 20, W - 20)

    rapidLeft = Math.max(0, rapidLeft - dt)
    spreadLeft = Math.max(0, spreadLeft - dt)
    safeLeft = Math.max(0, safeLeft - dt)
    fireCooldown -= dt
    if ((input.down('Space') || input.pointer.down) && fireCooldown <= 0) {
      const angles = spreadLeft > 0 ? [-0.18, 0, 0.18] : [0]
      for (const a of angles) shots.push({ x: ship.x, y: shipY() - 18, vx: Math.sin(a) * H * 1.3, vy: -Math.cos(a) * H * 1.3, enemy: false })
      fireCooldown = rapidLeft > 0 ? 0.1 : 0.26
      ctx.audio.blip(880, 30, 'square', 0.35)
    }

    if (!enemies.length) {
      nextWaveIn -= dt
      if (nextWaveIn <= 0) {
        spawnWave()
        nextWaveIn = 1.2
      }
    }

    for (const e of enemies) {
      e.phase += dt
      if (e.kind === 'boss') {
        e.y = Math.min(60, e.y + H * 0.2 * dt)
        e.x = W / 2 - e.w / 2 + Math.sin(e.phase * 0.9) * (W / 2 - e.w / 2 - 10)
      } else {
        const targetY = e.y < 60 ? e.y + H * 0.3 * dt : e.y + H * 0.012 * speed * dt
        e.y = targetY
        e.x += Math.sin(e.phase * 1.6) * W * 0.12 * speed * dt
      }
      e.cooldown -= dt
      if (e.cooldown <= 0 && e.y > 0) {
        if (e.kind === 'boss') {
          for (const a of [-0.5, -0.25, 0, 0.25, 0.5]) shots.push({ x: e.x + e.w / 2, y: e.y + e.h, vx: Math.sin(a) * H * 0.35, vy: Math.cos(a) * H * 0.35, enemy: true })
          e.cooldown = Math.max(0.7, 1.6 / factor)
        } else if (Math.random() < 0.3 * speed) {
          shots.push({ x: e.x + e.w / 2, y: e.y + e.h, vx: 0, vy: H * 0.42 * speed, enemy: true })
          e.cooldown = (2 + Math.random() * 4) / speed
        } else e.cooldown = 1 + Math.random() * 2
      }
      if (e.y + e.h >= shipY() - 10) {
        e.hp = 0
        if (hitShip()) return input.endStep()
      }
    }

    for (const s of shots) {
      s.x += s.vx * dt
      s.y += s.vy * dt
      if (s.enemy) {
        if (Math.hypot(s.x - ship.x, s.y - shipY()) < 16) {
          s.y = H + 50
          if (hitShip()) return input.endStep()
        }
        continue
      }
      for (const e of enemies) {
        if (e.hp <= 0 || !circleRect(s.x, s.y, 3, e.x, e.y, e.w, e.h)) continue
        e.hp--
        s.y = -50
        if (e.hp <= 0) {
          points += e.kind === 'boss' ? 1000 : e.kind === 'striker' ? 40 : 20
          ctx.audio.blip(e.kind === 'boss' ? 200 : 420, e.kind === 'boss' ? 500 : 60, 'triangle', 0.7)
          const chance = e.kind === 'boss' ? 1 : 0.06
          if (Math.random() < chance) drops.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, kind: (['rapid', 'spread', 'shield'] as const)[Math.floor(Math.random() * 3)] })
        }
        break
      }
    }
    for (const d of drops) {
      d.y += H * 0.22 * dt
      if (Math.abs(d.x - ship.x) < 22 && Math.abs(d.y - shipY()) < 22) {
        d.y = H + 50
        points += 50
        ctx.audio.blip(1200, 100, 'sine')
        if (d.kind === 'rapid') rapidLeft = 10
        else if (d.kind === 'spread') spreadLeft = 10
        else shield = true
      }
    }
    enemies = enemies.filter((e) => e.hp > 0 && e.y < H)
    shots = shots.filter((s) => s.y > -20 && s.y < H + 20 && s.x > -20 && s.x < W + 20)
    drops = drops.filter((d) => d.y < H + 20)
    emit()
    input.endStep()
  }

  const draw = (): void => {
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)
    for (const e of enemies) {
      g.fillStyle = e.kind === 'boss' ? colors.danger : e.kind === 'striker' ? colors.accent : colors.secondary
      g.beginPath()
      if (e.kind === 'boss') {
        g.roundRect(e.x, e.y, e.w, e.h, 14)
        g.fill()
        const max = Math.round((30 + wave * 6) * factor)
        g.fillStyle = colors.bgSoft
        g.fillRect(40, 16, W - 80, 6)
        g.fillStyle = colors.danger
        g.fillRect(40, 16, (W - 80) * (e.hp / max), 6)
      } else {
        g.moveTo(e.x, e.y)
        g.lineTo(e.x + e.w, e.y)
        g.lineTo(e.x + e.w * 0.75, e.y + e.h)
        g.lineTo(e.x + e.w * 0.25, e.y + e.h)
        g.closePath()
        g.fill()
      }
    }
    for (const s of shots) {
      g.fillStyle = s.enemy ? colors.warn : colors.primary
      g.fillRect(s.x - 2, s.y - 6, 4, 12)
    }
    g.font = '700 11px system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    for (const d of drops) {
      g.fillStyle = d.kind === 'rapid' ? colors.warn : d.kind === 'spread' ? colors.primary : colors.good
      g.beginPath()
      g.arc(d.x, d.y, 11, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = colors.bg
      g.fillText(d.kind === 'rapid' ? 'R' : d.kind === 'spread' ? 'S' : 'O', d.x, d.y + 1)
    }
    g.textBaseline = 'alphabetic'
    const y = shipY()
    if (!(safeLeft > 0 && !ctx.prefs.reducedMotion && Math.floor(safeLeft * 10) % 2)) {
      g.fillStyle = colors.primary
      g.beginPath()
      g.moveTo(ship.x, y - 18)
      g.lineTo(ship.x + 18, y + 12)
      g.lineTo(ship.x, y + 5)
      g.lineTo(ship.x - 18, y + 12)
      g.closePath()
      g.fill()
    }
    if (shield) {
      g.strokeStyle = colors.good
      g.lineWidth = 2
      g.beginPath()
      g.arc(ship.x, y, 26, 0, Math.PI * 2)
      g.stroke()
    }
    if (status === 'ready') {
      g.fillStyle = colors.text
      g.font = '600 16px system-ui, sans-serif'
      g.fillText('Hold Space to fire · ← → to move', W / 2, H * 0.45)
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
      ship.x = clamp(ship.x, 20, W - 20)
      draw()
    }
  }
  return instance
}

const arcadeShooter: GameModule = { id: 'arcade-shooter', surface: 'canvas', create }
export default arcadeShooter
