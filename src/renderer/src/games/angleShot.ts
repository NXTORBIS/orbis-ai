import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import { clamp, createLoop, fitCanvas, palette } from './engine'
import type { Ball, Hole } from '../../../shared/games/angleShot.ts'
import { BALL_R, HEIGHT, HOLES, STEP, TARGET_R, WIDTH, advance, holeWords, launch, makeHole, roundScore, simulate } from '../../../shared/games/angleShot.ts'

/**
 * Angle Shot: pick an angle, pick a strength, let go. Gravity brings it down, the wind takes it sideways, and there is
 * something in the way. Nine holes, and the score is the number of shots you took -- so a lower score is a better one.
 * (The catalogue calls that kind of score `lower-ms`, which is the only "lower is better" kind it has. The number in
 * this game is shots, not milliseconds.)
 *
 * The flight is in `src/shared/games/angleShot.ts`, stepped here once per fixed step so what is drawn is what was
 * worked out. The holes come from there too, and none of them is handed over until a single shot has been found that
 * holes it -- the test re-finds that shot for every hole of twelve rounds with the slow search.
 */

interface Saved {
  seed: number
  difficulty: string
  hole: number
  shots: number[]
  thisHole: number
}

/** How far the pointer has to be dragged for full strength. */
const FULL_DRAG = 240

function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 800
  let H = 500
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const reduced = ctx.prefs.reducedMotion

  let status: GameStatus = 'ready'
  let seed = Date.now() & 0xffff
  let index = 0
  let hole: Hole = makeHole(0, seed, ctx.prefs.difficulty)
  let ball: Ball = { x: hole.tee.x, y: hole.tee.y, vx: 0, vy: 0, resting: true }
  let angle = 45
  let power = 0.7
  let flying = false
  let trail: { x: number; y: number }[] = []
  let shots: number[] = []
  let thisHole = 0
  let aiming = false
  let holed = false
  let pauseLeft = 0
  let message = ''
  let elapsed = 0
  let lastEmit = 0

  const scale = (): number => Math.min(W / WIDTH, (H - 40) / HEIGHT)
  const originX = (): number => (W - WIDTH * scale()) / 2
  const groundY = (): number => H - 26

  const toScreen = (x: number, y: number): { x: number; y: number } => ({ x: originX() + x * scale(), y: groundY() - y * scale() })

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 100) return
    lastEmit = performance.now()
    ctx.emit({
      status,
      score: roundScore(shots) + thisHole,
      level: index + 1,
      elapsedMs: Math.round(elapsed * 1000),
      difficulty: index + 1,
      hud: [{ label: 'Hole', value: `${index + 1} of ${HOLES}` }, { label: 'Shots here', value: thisHole }, { label: 'Par', value: hole.par }, { label: 'Wind', value: hole.wind === 0 ? 'still' : `${Math.abs(hole.wind)} ${hole.wind > 0 ? 'with you' : 'against'}` }]
    })
  }

  const save = (): void => {
    if (status === 'over') return ctx.save?.(null)
    ctx.save?.({ seed, difficulty: ctx.prefs.difficulty, hole: index, shots, thisHole } satisfies Saved)
  }

  const openHole = (which: number): void => {
    index = which
    hole = makeHole(which, seed, ctx.prefs.difficulty)
    ball = { x: hole.tee.x, y: hole.tee.y, vx: 0, vy: 0, resting: true }
    angle = 45
    power = 0.7
    thisHole = 0
    flying = false
    holed = false
    trail = []
    message = which === 0 ? 'Drag from the ball, or use the arrow keys, then let go' : `Hole ${which + 1}: ${Math.round(hole.target.x - hole.tee.x)} across, ${hole.wind === 0 ? 'still air' : hole.wind > 0 ? 'wind with you' : 'wind against you'}`
    emit(true)
  }

  const reset = (): void => {
    status = 'ready'
    seed = (Date.now() + Math.floor(Math.random() * 1e6)) & 0xffffff
    shots = []
    elapsed = 0
    pauseLeft = 0
    openHole(0)
  }

  const shoot = (): void => {
    if (flying || holed || status !== 'running') return
    ball = launch({ x: ball.x, y: ball.y }, angle, power)
    flying = true
    thisHole++
    trail = [{ x: ball.x, y: ball.y }]
    message = ''
    ctx.audio.blip(300 + power * 500, 90, 'triangle', 0.7)
    emit(true)
  }

  const finishHole = (): void => {
    shots.push(thisHole)
    holed = true
    message = holeWords(thisHole, hole.par)
    pauseLeft = reduced ? 1 : 1.8
    ctx.audio.blip(880, 160, 'sine')
    ctx.audio.blip(1320, 200, 'sine')
    save()
    emit(true)
  }

  const finishRound = (): void => {
    status = 'over'
    ctx.save?.(null)
    emit(true)
    ctx.over({ score: roundScore(shots), extra: { attempts: shots.length, difficulty: ctx.prefs.difficulty } })
  }

  const step = (dt: number): void => {
    const input = ctx.input
    if (status === 'running' && input.pressed('KeyP', 'Enter')) {
      input.endStep()
      return instance.pause()
    }
    if (status === 'ready' && (input.taps > 0 || input.pressed('Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'))) {
      status = 'running'
      emit(true)
      return input.endStep()
    }
    if (status !== 'running') return input.endStep()
    elapsed += dt

    if (holed) {
      pauseLeft -= dt
      if (pauseLeft <= 0) {
        if (index + 1 >= HOLES) {
          finishRound()
          return input.endStep()
        }
        openHole(index + 1)
      }
      emit()
      return input.endStep()
    }

    if (flying) {
      // The flight, stepped at the rate it was worked out at, however often this is called.
      let left = dt
      while (left > 0 && flying) {
        const result = advance(hole, ball, Math.min(STEP, left))
        left -= STEP
        if (trail.length < 900) trail.push({ x: ball.x, y: ball.y })
        if (result.hit === 'ground') ctx.audio.blip(220, 40, 'sine', 0.35)
        else if (result.hit) ctx.audio.blip(160, 50, 'square', 0.3)
        if (result.in) {
          flying = false
          finishHole()
          return input.endStep()
        }
        if (ball.resting) {
          flying = false
          save()
        }
      }
      emit()
      return input.endStep()
    }

    // Aiming. The keys nudge; a drag from the ball sets both at once.
    // The angle runs from flat to the right, up over the top, and down to flat to the left, so a ball that has ended
    // up past the hole can be played back towards it.
    if (input.down('ArrowLeft', 'KeyA')) angle = clamp(angle + 40 * dt, 1, 179)
    if (input.down('ArrowRight', 'KeyD')) angle = clamp(angle - 40 * dt, 1, 179)
    if (input.down('ArrowUp', 'KeyW')) power = clamp(power + 0.5 * dt, 0.1, 1)
    if (input.down('ArrowDown', 'KeyS')) power = clamp(power - 0.5 * dt, 0.1, 1)
    if (input.pointer.down) {
      const s = scale()
      const at = toScreen(ball.x, ball.y)
      const dx = (input.pointer.x - at.x) / s
      const dy = (at.y - input.pointer.y) / s
      const length = Math.hypot(dx, dy)
      if (length > 6) {
        aiming = true
        angle = clamp((Math.atan2(Math.max(0, dy), dx) * 180) / Math.PI, 1, 179)
        power = clamp(length / FULL_DRAG, 0.1, 1)
      }
    } else if (aiming) {
      aiming = false
      shoot()
    }
    if (input.pressed('Space')) shoot()
    emit()
    input.endStep()
  }

  // ---------------------------------------------------------------- drawing

  const draw = (): void => {
    const s = scale()
    const ox = originX()
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)

    // Sky and ground.
    const sky = g.createLinearGradient(0, 0, 0, groundY())
    sky.addColorStop(0, ctx.prefs.highContrast ? '#000022' : '#0a1429')
    sky.addColorStop(1, ctx.prefs.highContrast ? '#000000' : '#101c33')
    g.fillStyle = sky
    g.fillRect(ox, 0, WIDTH * s, groundY())
    g.fillStyle = ctx.prefs.highContrast ? '#004400' : '#16351f'
    g.fillRect(ox, groundY(), WIDTH * s, H - groundY())

    for (const block of hole.blocks) {
      const top = toScreen(block.x, block.y + block.h)
      g.fillStyle = ctx.prefs.highContrast ? '#666666' : '#2c3344'
      g.fillRect(top.x, top.y, block.w * s, block.h * s)
      g.fillStyle = 'rgba(255,255,255,0.08)'
      g.fillRect(top.x, top.y, block.w * s, 3)
    }

    // The hole, with a flag beside it.
    const target = toScreen(hole.target.x, hole.target.y)
    g.strokeStyle = colors.muted
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(target.x + TARGET_R * s, target.y)
    g.lineTo(target.x + TARGET_R * s, target.y - 54)
    g.stroke()
    g.fillStyle = colors.danger
    g.beginPath()
    g.moveTo(target.x + TARGET_R * s, target.y - 54)
    g.lineTo(target.x + TARGET_R * s + 26, target.y - 46)
    g.lineTo(target.x + TARGET_R * s, target.y - 38)
    g.closePath()
    g.fill()
    g.fillStyle = holed ? colors.good : colors.bgSoft
    g.beginPath()
    g.ellipse(target.x, target.y, TARGET_R * s, TARGET_R * s * 0.5, 0, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = colors.good
    g.lineWidth = 2
    g.stroke()

    // Where the last shot went.
    if (trail.length > 1) {
      g.strokeStyle = 'rgba(160, 210, 255, 0.35)'
      g.lineWidth = 1.5
      g.setLineDash([4, 4])
      g.beginPath()
      trail.forEach((point, i) => {
        const at = toScreen(point.x, point.y)
        if (i === 0) g.moveTo(at.x, at.y)
        else g.lineTo(at.x, at.y)
      })
      g.stroke()
      g.setLineDash([])
    }

    // The aim: the angle and the strength, and the first moment of the flight.
    if (!flying && !holed) {
      const at = toScreen(ball.x, ball.y)
      const guide = simulate(hole, { x: ball.x, y: ball.y }, angle, power, 0.4)
      g.strokeStyle = 'rgba(63, 216, 255, 0.55)'
      g.lineWidth = 2
      g.beginPath()
      guide.path.forEach((point, i) => {
        const screen = toScreen(point.x, point.y)
        if (i === 0) g.moveTo(screen.x, screen.y)
        else g.lineTo(screen.x, screen.y)
      })
      g.stroke()
      // The strength, as a bar beside the ball.
      g.fillStyle = 'rgba(0,0,0,0.4)'
      g.fillRect(at.x - 26, at.y + 14, 52, 7)
      g.fillStyle = power > 0.85 ? colors.danger : power > 0.6 ? colors.warn : colors.good
      g.fillRect(at.x - 26, at.y + 14, 52 * power, 7)
      g.fillStyle = colors.text
      g.font = '11px system-ui, sans-serif'
      g.textAlign = 'center'
      g.fillText(`${Math.round(angle)}°  ${Math.round(power * 100)}%`, at.x, at.y + 34)
    }

    // The ball.
    const ballAt = toScreen(ball.x, ball.y)
    g.fillStyle = colors.text
    g.beginPath()
    g.arc(ballAt.x, ballAt.y, Math.max(3, BALL_R * s), 0, Math.PI * 2)
    g.fill()

    // The wind, along the top.
    g.textAlign = 'center'
    g.font = '12px system-ui, sans-serif'
    g.fillStyle = colors.muted
    if (hole.wind === 0) g.fillText('Still air', ox + WIDTH * s * 0.5, 20)
    else {
      const strength = Math.min(1, Math.abs(hole.wind) / 160)
      g.fillStyle = strength > 0.6 ? colors.warn : colors.muted
      const drift = reduced ? 0 : Math.sin(elapsed * 2) * 4
      g.fillText(`${hole.wind > 0 ? '→' : '←'} wind ${Math.abs(hole.wind)}`, ox + WIDTH * s * 0.5 + drift, 20)
    }

    if (message) {
      g.fillStyle = 'rgba(0,0,0,0.55)'
      g.fillRect(ox, H - 24, WIDTH * s, 24)
      g.fillStyle = colors.text
      g.font = '13px system-ui, sans-serif'
      g.fillText(message, ox + (WIDTH * s) / 2, H - 7)
    }
    if (status === 'ready') {
      g.fillStyle = 'rgba(0,0,0,0.72)'
      g.fillRect(ox, H * 0.26, WIDTH * s, 118)
      g.fillStyle = colors.text
      g.font = '600 18px system-ui, sans-serif'
      g.fillText('Nine holes. Fewest shots wins.', ox + (WIDTH * s) / 2, H * 0.26 + 30)
      g.fillStyle = colors.muted
      g.font = '13px system-ui, sans-serif'
      g.fillText('Drag away from the ball to aim and let go to shoot', ox + (WIDTH * s) / 2, H * 0.26 + 54)
      g.fillText('Keyboard: left and right for the angle, up and down for the strength, Space to shoot', ox + (WIDTH * s) / 2, H * 0.26 + 74)
      g.fillStyle = colors.primary
      g.font = '600 14px system-ui, sans-serif'
      g.fillText('Click or press a key to begin', ox + (WIDTH * s) / 2, H * 0.26 + 100)
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
      save()
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
      ctx.save?.(null)
      loop.start()
    },
    restore(saved) {
      const kept = saved as Partial<Saved> | null
      if (!kept || typeof kept.seed !== 'number' || kept.difficulty !== ctx.prefs.difficulty) return false
      if (!Array.isArray(kept.shots) || !kept.shots.every((one) => Number.isInteger(one) && one > 0 && one < 99)) return false
      const which = kept.hole
      const taken = kept.thisHole
      if (typeof which !== 'number' || !Number.isInteger(which) || which < 0 || which >= HOLES) return false
      seed = kept.seed
      shots = kept.shots.slice(0, which)
      openHole(which)
      thisHole = typeof taken === 'number' && Number.isInteger(taken) && taken >= 0 && taken < 99 ? taken : 0
      message = `Back at hole ${index + 1}`
      emit(true)
      return true
    },
    destroy() {
      loop.stop()
      save()
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

const angleShot: GameModule = { id: 'angle-shot', surface: 'canvas', create }
export default angleShot
