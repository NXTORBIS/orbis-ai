import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import { clamp, createLoop, fitCanvas, palette } from './engine'
import type { Rock } from '../../../shared/games/drift'
import { DRIFT_LEVELS, FIELD, hitsRock, jumpSpot, ROCK_RADIUS, rockScore, splitRock, waveBonus, waveRocks, wrap } from '../../../shared/games/drift'

interface Shot {
  x: number
  y: number
  vx: number
  vy: number
  left: number
}

const SHIP_RADIUS = 13
const TURN_RATE = 3.5
const THRUST = 470
const MAX_SPEED = 540
const SHOT_SPEED = 620
const SHOT_LIFE = 1.15

/**
 * Drift: turn, thrust, and shoot the rocks apart. Nothing slows you down — there is no friction out here, so the only
 * way to stop is to turn around and thrust the other way, and that is the whole difficulty of it. Leaving one side of
 * the field brings you in at the other.
 *
 * A shot breaks a big rock into two middling ones and a middling one into two small ones, and the pieces come out
 * faster than what they came from, so a careless shot into a crowd makes things worse. The jump moves you somewhere
 * else on the field: it looks for a clear spot, and when the field is too crowded to find one, or your luck is simply
 * out, it kills you. That risk is the point of it.
 */
function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 760
  let H = 520
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const level = DRIFT_LEVELS[ctx.prefs.difficulty]

  let status: GameStatus = 'ready'
  let ship = { x: FIELD.width / 2, y: FIELD.height / 2, vx: 0, vy: 0, angle: -Math.PI / 2 }
  let rocks: Rock[] = []
  let shots: Shot[] = []
  let sparks: { x: number; y: number; vx: number; vy: number; left: number }[] = []
  let lives = level.lives
  let wave = 1
  let points = 0
  let grace = 0
  let jumpLeft = 0
  let waveGap = 0
  let elapsed = 0
  let lastEmit = 0
  let message = ''
  let jumpWanted = false

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 100) return
    lastEmit = performance.now()
    ctx.emit({
      status,
      score: points,
      level: wave,
      lives,
      elapsedMs: Math.round(elapsed * 1000),
      difficulty: Math.round((rocks.length / Math.max(1, level.waveBase)) * 100) / 100,
      hud: [
        { label: 'Rocks', value: rocks.length },
        { label: 'Jump', value: jumpLeft > 0 ? `${jumpLeft.toFixed(1)}s` : 'ready' }
      ]
    })
  }

  const spawnWave = (): void => {
    rocks = waveRocks(wave, level, ship, Math.random)
    shots = []
  }

  const reset = (): void => {
    status = 'ready'
    ship = { x: FIELD.width / 2, y: FIELD.height / 2, vx: 0, vy: 0, angle: -Math.PI / 2 }
    lives = level.lives
    wave = 1
    points = 0
    grace = level.grace
    jumpLeft = 0
    waveGap = 0
    elapsed = 0
    sparks = []
    message = ''
    jumpWanted = false
    spawnWave()
    emit(true)
  }

  const burst = (x: number, y: number, count: number, speed: number): void => {
    if (ctx.prefs.reducedMotion) return
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      sparks.push({ x, y, vx: Math.cos(a) * speed * (0.4 + Math.random()), vy: Math.sin(a) * speed * (0.4 + Math.random()), left: 0.35 + Math.random() * 0.4 })
    }
  }

  const die = (why: string): void => {
    lives--
    burst(ship.x, ship.y, 22, 220)
    ctx.audio.blip(90, 480, 'sawtooth')
    if (lives <= 0) {
      status = 'over'
      message = ''
      emit(true)
      ctx.over({ score: points, extra: { difficulty: ctx.prefs.difficulty, bestStreak: wave } })
      return
    }
    message = `${why} ${lives} ${lives === 1 ? 'ship' : 'ships'} left.`
    ship = { x: FIELD.width / 2, y: FIELD.height / 2, vx: 0, vy: 0, angle: -Math.PI / 2 }
    grace = level.grace
  }

  const fire = (): void => {
    if (shots.length >= level.shots) return
    shots.push({
      x: ship.x + Math.cos(ship.angle) * SHIP_RADIUS,
      y: ship.y + Math.sin(ship.angle) * SHIP_RADIUS,
      vx: ship.vx + Math.cos(ship.angle) * SHOT_SPEED,
      vy: ship.vy + Math.sin(ship.angle) * SHOT_SPEED,
      left: SHOT_LIFE
    })
    ctx.audio.blip(760, 45, 'square', 0.5)
  }

  const jump = (): void => {
    if (status !== 'running' || jumpLeft > 0) return
    jumpLeft = level.jumpCooldown
    const spot = jumpSpot(rocks, SHIP_RADIUS + 34, Math.random)
    ship.x = spot.x
    ship.y = spot.y
    ctx.audio.blip(240, 180, 'sine', 0.8)
    // Out of the frying pan: sometimes there is nowhere clear to land, and sometimes you are just unlucky.
    if (!spot.clear || Math.random() < level.risk) die('The jump went wrong.')
    else grace = Math.max(grace, 0.6)
  }

  const step = (dt: number): void => {
    const input = ctx.input
    if (jumpWanted) {
      jumpWanted = false
      if (status === 'running') jump()
    }
    if (status === 'running' && input.pressed('KeyP', 'Enter')) {
      input.endStep()
      return instance.pause()
    }
    if (status === 'ready' && (input.down('ArrowUp', 'KeyW', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD') || input.pressed('Space') || input.taps > 0)) {
      status = 'running'
      message = ''
    }
    if (status !== 'running') return input.endStep()
    elapsed += dt
    jumpLeft = Math.max(0, jumpLeft - dt)
    grace = Math.max(0, grace - dt)

    if (input.down('ArrowLeft', 'KeyA')) ship.angle -= TURN_RATE * dt
    if (input.down('ArrowRight', 'KeyD')) ship.angle += TURN_RATE * dt
    const pointerDown = input.pointer.down
    if (pointerDown) {
      // Aiming with the mouse: turn towards it, no faster than the keys would.
      const scale = Math.min(W / FIELD.width, H / FIELD.height)
      const ox = (W - FIELD.width * scale) / 2
      const oy = (H - FIELD.height * scale) / 2
      const want = Math.atan2((input.pointer.y - oy) / scale - ship.y, (input.pointer.x - ox) / scale - ship.x)
      let turn = want - ship.angle
      while (turn > Math.PI) turn -= Math.PI * 2
      while (turn < -Math.PI) turn += Math.PI * 2
      ship.angle += clamp(turn, -TURN_RATE * dt, TURN_RATE * dt)
    }
    const thrusting = input.down('ArrowUp', 'KeyW') || pointerDown
    if (thrusting) {
      ship.vx += Math.cos(ship.angle) * THRUST * dt
      ship.vy += Math.sin(ship.angle) * THRUST * dt
      const speed = Math.hypot(ship.vx, ship.vy)
      if (speed > MAX_SPEED) {
        ship.vx = (ship.vx / speed) * MAX_SPEED
        ship.vy = (ship.vy / speed) * MAX_SPEED
      }
      if (!ctx.prefs.reducedMotion) burst(ship.x - Math.cos(ship.angle) * SHIP_RADIUS, ship.y - Math.sin(ship.angle) * SHIP_RADIUS, 1, 60)
    }
    if (input.pressed('Space') || input.taps > 0) fire()
    if (input.pressed('KeyF')) jump()

    ship.x = wrap(ship.x + ship.vx * dt, FIELD.width)
    ship.y = wrap(ship.y + ship.vy * dt, FIELD.height)

    for (const rock of rocks) {
      rock.x = wrap(rock.x + rock.vx * dt, FIELD.width)
      rock.y = wrap(rock.y + rock.vy * dt, FIELD.height)
      rock.angle += rock.spin * dt
    }
    shots = shots.filter((s) => {
      s.left -= dt
      s.x = wrap(s.x + s.vx * dt, FIELD.width)
      s.y = wrap(s.y + s.vy * dt, FIELD.height)
      return s.left > 0
    })
    sparks = sparks.filter((p) => {
      p.left -= dt
      p.x = wrap(p.x + p.vx * dt, FIELD.width)
      p.y = wrap(p.y + p.vy * dt, FIELD.height)
      return p.left > 0
    })

    // A shot that lands breaks the rock it hit; the pieces are already moving when they appear.
    for (let s = shots.length - 1; s >= 0; s--) {
      const shot = shots[s]
      const hit = rocks.findIndex((rock) => hitsRock(rock, shot.x, shot.y, 3))
      if (hit < 0) continue
      const rock = rocks[hit]
      points += rockScore(rock.size)
      burst(rock.x, rock.y, 8, 90)
      ctx.audio.blip(rock.size === 3 ? 180 : rock.size === 2 ? 280 : 420, 110, 'triangle', 0.7)
      rocks.splice(hit, 1, ...splitRock(rock, Math.random))
      shots.splice(s, 1)
    }

    if (grace <= 0) {
      const struck = rocks.find((rock) => hitsRock(rock, ship.x, ship.y, SHIP_RADIUS))
      if (struck) die('Hit a rock.')
    }

    if (!rocks.length && status === 'running') {
      if (!waveGap) {
        points += waveBonus(wave)
        message = `Field clear. Wave ${wave + 1} coming.`
        ctx.audio.blip(880, 280, 'triangle')
        waveGap = 1.8
      } else {
        waveGap -= dt
        if (waveGap <= 0) {
          waveGap = 0
          wave++
          message = ''
          grace = Math.max(grace, 1)
          spawnWave()
        }
      }
    }
    emit()
    input.endStep()
  }

  // ---------------------------------------------------------------- drawing

  const draw = (): void => {
    const scale = Math.min(W / FIELD.width, H / FIELD.height)
    const ox = (W - FIELD.width * scale) / 2
    const oy = (H - FIELD.height * scale) / 2
    const px = (x: number): number => ox + x * scale
    const py = (y: number): number => oy + y * scale
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)
    g.strokeStyle = colors.bgSoft
    g.lineWidth = 2
    g.strokeRect(ox, oy, FIELD.width * scale, FIELD.height * scale)

    g.fillStyle = colors.muted
    for (const p of sparks) {
      g.globalAlpha = Math.max(0, Math.min(1, p.left * 2))
      g.fillRect(px(p.x) - 1, py(p.y) - 1, 2.5, 2.5)
    }
    g.globalAlpha = 1

    g.strokeStyle = colors.primary
    g.lineWidth = Math.max(1.4, 2 * scale)
    for (const rock of rocks) {
      const r = ROCK_RADIUS[rock.size] * scale
      // Rocks near an edge are drawn again on the other side, so nothing pops in or out at the seam.
      const xs = [rock.x, rock.x + FIELD.width, rock.x - FIELD.width].filter((x) => px(x) > ox - r * 2 && px(x) < ox + FIELD.width * scale + r * 2)
      const ys = [rock.y, rock.y + FIELD.height, rock.y - FIELD.height].filter((y) => py(y) > oy - r * 2 && py(y) < oy + FIELD.height * scale + r * 2)
      for (const x of xs)
        for (const y of ys) {
          g.beginPath()
          rock.rim.forEach((lump, i) => {
            const a = rock.angle + (i / rock.rim.length) * Math.PI * 2
            const point = [px(x) + Math.cos(a) * r * lump, py(y) + Math.sin(a) * r * lump] as const
            if (i) g.lineTo(point[0], point[1])
            else g.moveTo(point[0], point[1])
          })
          g.closePath()
          g.stroke()
        }
    }

    g.fillStyle = colors.secondary
    for (const shot of shots) {
      g.beginPath()
      g.arc(px(shot.x), py(shot.y), Math.max(1.6, 3 * scale), 0, Math.PI * 2)
      g.fill()
    }

    if (status !== 'over') {
      const flashing = grace > 0 && !ctx.prefs.reducedMotion && Math.floor(elapsed * 10) % 2 === 0
      g.save()
      g.translate(px(ship.x), py(ship.y))
      g.rotate(ship.angle)
      g.strokeStyle = flashing ? colors.muted : colors.text
      g.lineWidth = Math.max(1.6, 2.4 * scale)
      g.beginPath()
      g.moveTo(SHIP_RADIUS * scale * 1.3, 0)
      g.lineTo(-SHIP_RADIUS * scale, SHIP_RADIUS * scale * 0.8)
      g.lineTo(-SHIP_RADIUS * scale * 0.5, 0)
      g.lineTo(-SHIP_RADIUS * scale, -SHIP_RADIUS * scale * 0.8)
      g.closePath()
      g.stroke()
      if (ctx.input.down('ArrowUp', 'KeyW') || ctx.input.pointer.down) {
        g.strokeStyle = colors.warn
        g.beginPath()
        g.moveTo(-SHIP_RADIUS * scale * 0.6, 0)
        g.lineTo(-SHIP_RADIUS * scale * 1.7, 0)
        g.stroke()
      }
      g.restore()
      if (grace > 0) {
        g.strokeStyle = colors.good
        g.lineWidth = 1.5
        g.beginPath()
        g.arc(px(ship.x), py(ship.y), (SHIP_RADIUS + 9) * scale, 0, Math.PI * 2)
        g.stroke()
      }
    }

    g.textAlign = 'center'
    g.fillStyle = colors.text
    if (status === 'ready') {
      g.font = '600 18px system-ui, sans-serif'
      g.fillText('Left and right turn, up thrusts, Space fires.', W / 2, H / 2 - 24)
      g.font = '500 14px system-ui, sans-serif'
      g.fillStyle = colors.muted
      g.fillText('Shift or F jumps you somewhere else — it can go wrong. Nothing slows you down but your own thrust.', W / 2, H / 2 + 2)
      g.fillText('Or hold the mouse to aim and thrust, and click to fire.', W / 2, H / 2 + 24)
    } else if (message) {
      g.font = '600 18px system-ui, sans-serif'
      g.fillText(message, W / 2, H / 2)
    }
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey) return
    if (e.code !== 'ShiftLeft' && e.code !== 'ShiftRight') return
    e.preventDefault()
    e.stopPropagation()
    jumpWanted = true
  }
  ctx.root.addEventListener('keydown', onKey)

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
      ctx.root.removeEventListener('keydown', onKey)
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

const asteroidField: GameModule = { id: 'asteroid-field', surface: 'canvas', create }
export default asteroidField
