import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import { clamp, createLoop, fitCanvas, palette } from './engine'
import type { Ledge } from '../../../shared/games/platformClimb.ts'
import { GRAVITY, JUMP_V, LEDGE_H, LEDGE_W, MAX_VX, PLAYER_W, START_LEDGE, WIDTH, bounceFrom, climbScore, ledgeWords, ledgeX, makeLedges } from '../../../shared/games/platformClimb.ts'

/**
 * Up and Up: bounce from ledge to ledge for as long as you can, and the moment you drop off the bottom of the screen it
 * is over. The bounce is the same height every time, so this is about where you land, not when you press anything.
 *
 * The ledges and the arithmetic of what can be reached are in `src/shared/games/platformClimb.ts`, where a test climbs
 * three hundred ledges on fifty seeds and insists every one of them can be reached from the one below. This file is the
 * falling, the landing and the view that follows you up.
 */

const PLAYER_H = 30
/** How much world fits on the screen at once, before it is scaled to the canvas. */
const VIEW = 560

function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 700
  let H = 500
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const reduced = ctx.prefs.reducedMotion

  let status: GameStatus = 'ready'
  let seed = Date.now() & 0xffff
  let ledges: Ledge[] = []
  let made = 0
  let x = START_LEDGE.x + (LEDGE_W - PLAYER_W) / 2
  let y = 0
  let vx = 0
  let vy = 0
  let camY = -120
  let highest = 0
  let bounces = 0
  let elapsed = 0
  let message = ''
  let messageLeft = 0
  let lastEmit = 0

  const scale = (): number => Math.min(W / WIDTH, H / VIEW)
  const viewHeight = (): number => H / scale()
  const offsetX = (): number => (W - WIDTH * scale()) / 2

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 100) return
    lastEmit = performance.now()
    ctx.emit({
      status,
      score: climbScore(highest),
      elapsedMs: Math.round(elapsed * 1000),
      difficulty: 1 + Math.round((made / 300) * 100) / 100,
      hud: [{ label: 'Height', value: `${Math.round(highest / 10)}m` }, { label: 'Ledges', value: bounces }]
    })
  }

  /** Keep enough climb above the view. Each batch raises the top, so this always finishes. */
  const grow = (): void => {
    while (ledges.length < 400) {
      const top = ledges.at(-1) ?? START_LEDGE
      if (top.y > camY + viewHeight() * 2.5 && ledges.length >= 40) return
      const batch = makeLedges(seed, ctx.prefs.difficulty, top, made, 30)
      made += batch.length
      ledges.push(...batch)
    }
  }

  const reset = (): void => {
    status = 'ready'
    seed = (Date.now() + Math.floor(Math.random() * 1e6)) & 0xffffff
    ledges = [{ ...START_LEDGE }]
    made = 0
    x = START_LEDGE.x + (LEDGE_W - PLAYER_W) / 2
    y = 0
    vx = 0
    vy = JUMP_V
    camY = -140
    highest = 0
    bounces = 0
    elapsed = 0
    message = 'Left and right to steer. The bounce looks after itself.'
    messageLeft = 4
    grow()
    emit(true)
  }

  /** The horizontal distance between two things, the short way round the screen. */
  const across = (a: number, b: number): number => {
    let d = a - b
    while (d > WIDTH / 2) d -= WIDTH
    while (d < -WIDTH / 2) d += WIDTH
    return d
  }

  const land = (ledge: Ledge, top: number): void => {
    y = top
    vy = bounceFrom(ledge.kind)
    bounces++
    if (ledge.kind === 'crumble') ledge.gone = true
    ctx.audio.blip(ledge.kind === 'spring' ? 980 : 480 + Math.min(300, bounces * 3), ledge.kind === 'spring' ? 160 : 55, ledge.kind === 'spring' ? 'sine' : 'triangle', 0.5)
    const words = ledgeWords(ledge.kind)
    if (words) {
      message = words
      messageLeft = 1.6
    }
  }

  const step = (dt: number): void => {
    const input = ctx.input
    if (status === 'running' && input.pressed('KeyP', 'Enter')) {
      input.endStep()
      return instance.pause()
    }
    const steering = input.down('ArrowLeft', 'KeyA') || input.down('ArrowRight', 'KeyD')
    if (status === 'ready' && (steering || input.taps > 0 || input.pressed('Space'))) status = 'running'
    if (status !== 'running') return input.endStep()
    elapsed += dt
    if (messageLeft > 0) messageLeft -= dt

    // Steering: the keys push, and the pointer pulls towards wherever it is.
    if (input.down('ArrowLeft', 'KeyA')) vx -= MAX_VX * 7 * dt
    else if (input.down('ArrowRight', 'KeyD')) vx += MAX_VX * 7 * dt
    else if (performance.now() - input.pointer.movedAt < 1600 || input.pointer.down) {
      // Steer towards the pointer and settle there. Pushing in proportion to the distance alone -- which is what this
      // did first -- overshoots every time and sails straight past the ledge you were aiming at.
      const want = (input.pointer.x - offsetX()) / scale() - PLAYER_W / 2
      const wanted = clamp(across(want, x) * 6, -MAX_VX, MAX_VX)
      vx += clamp((wanted - vx) * 12, -MAX_VX * 12, MAX_VX * 12) * dt
    } else vx -= vx * 4 * dt
    vx = clamp(vx, -MAX_VX, MAX_VX)

    x += vx * dt
    if (x < -PLAYER_W) x += WIDTH
    if (x > WIDTH) x -= WIDTH

    const was = y
    vy -= GRAVITY * dt
    y += vy * dt

    if (vy < 0)
      for (const ledge of ledges) {
        if (ledge.gone) continue
        const top = ledge.y
        if (was < top || y > top) continue
        const left = ledgeX(ledge, elapsed)
        if (Math.abs(across(x + PLAYER_W / 2, left + LEDGE_W / 2)) < (PLAYER_W + LEDGE_W) / 2) {
          land(ledge, top)
          break
        }
      }

    if (y > highest) highest = y
    // The view only ever goes up, and dropping below the bottom of it ends the climb -- so where the climber sits in
    // the view is how much room there is to fall back onto a ledge below. At 0.42 there were seventy-five pixels under
    // the ledge just left, which made one missed jump the end of the run.
    const follow = y - viewHeight() * 0.58
    if (follow > camY) camY = follow
    grow()
    // Anything well below the screen is gone for good, so the list never grows without end.
    if (ledges.length > 120) ledges = ledges.filter((ledge) => ledge.y > camY - 160)

    if (y + PLAYER_H < camY) {
      status = 'over'
      ctx.audio.blip(120, 420, 'sawtooth')
      emit(true)
      ctx.over({ score: climbScore(highest), extra: { bestStreak: bounces, difficulty: ctx.prefs.difficulty } })
      return input.endStep()
    }
    emit()
    input.endStep()
  }

  // ---------------------------------------------------------------- drawing

  const draw = (): void => {
    const s = scale()
    const ox = offsetX()
    const screenY = (worldY: number): number => H - (worldY - camY) * s
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)
    g.fillStyle = ctx.prefs.highContrast ? '#000000' : '#070b14'
    g.fillRect(ox, 0, WIDTH * s, H)

    // A few lights in the background that drift past as you climb, so the climb reads as a climb.
    if (!reduced) {
      g.fillStyle = 'rgba(160, 210, 255, 0.18)'
      for (let i = 0; i < 40; i++) {
        const px = ox + ((i * 97) % WIDTH) * s
        const drift = (((i * 137 - camY * 0.25) % 1800) + 1800) % 1800
        const py = H - drift * (H / 1800)
        g.fillRect(px, py, 2, 2)
      }
    }

    // Every tenth of the climb, a line with the height on it.
    g.strokeStyle = 'rgba(160, 210, 255, 0.08)'
    g.fillStyle = colors.muted
    g.font = '10px system-ui, sans-serif'
    g.textAlign = 'left'
    const firstMark = Math.floor(camY / 500) * 500
    for (let mark = firstMark; mark < camY + viewHeight(); mark += 500) {
      if (mark <= 0) continue
      const py = screenY(mark)
      g.beginPath()
      g.moveTo(ox, py)
      g.lineTo(ox + WIDTH * s, py)
      g.stroke()
      g.fillText(`${Math.round(mark / 10)}m`, ox + 4, py - 3)
    }

    for (const ledge of ledges) {
      if (ledge.gone) continue
      const py = screenY(ledge.y)
      if (py < -20 || py > H + 20) continue
      const left = ledgeX(ledge, elapsed)
      g.fillStyle = ledge.kind === 'spring' ? colors.good : ledge.kind === 'crumble' ? colors.warn : ledge.kind === 'moving' ? colors.secondary : colors.primary
      const px = ox + left * s
      g.beginPath()
      g.roundRect(px, py, LEDGE_W * s, LEDGE_H * s, 4)
      g.fill()
      if (ledge.kind === 'crumble') {
        // Cracks, so a ledge that will not be there twice looks like one.
        g.strokeStyle = 'rgba(0,0,0,0.45)'
        g.lineWidth = 1
        for (let i = 1; i < 4; i++) {
          g.beginPath()
          g.moveTo(px + (LEDGE_W * s * i) / 4, py)
          g.lineTo(px + (LEDGE_W * s * i) / 4 - 3, py + LEDGE_H * s)
          g.stroke()
        }
      }
      if (ledge.kind === 'spring') {
        g.fillStyle = colors.text
        g.beginPath()
        g.moveTo(px + LEDGE_W * s * 0.5, py - 7)
        g.lineTo(px + LEDGE_W * s * 0.42, py)
        g.lineTo(px + LEDGE_W * s * 0.58, py)
        g.closePath()
        g.fill()
      }
      if (ledge.kind === 'moving') {
        g.fillStyle = 'rgba(0,0,0,0.3)'
        g.fillRect(px + LEDGE_W * s * 0.45, py + 2, LEDGE_W * s * 0.1, LEDGE_H * s - 4)
      }
    }

    // The climber, drawn twice while half of it is round the other side of the screen.
    const squash = reduced ? 1 : clamp(1 - vy / 4000, 0.86, 1.16)
    const shifts = x < 0 ? [0, WIDTH] : x + PLAYER_W > WIDTH ? [0, -WIDTH] : [0]
    for (const shift of shifts) {
      const px = ox + (x + shift) * s
      const py = screenY(y)
      g.fillStyle = colors.accent
      g.beginPath()
      g.ellipse(px + (PLAYER_W * s) / 2, py - (PLAYER_H * s * squash) / 2, (PLAYER_W * s) / 2 / squash, (PLAYER_H * s * squash) / 2, 0, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = colors.bg
      const eyeY = py - PLAYER_H * s * 0.62
      g.beginPath()
      g.arc(px + PLAYER_W * s * 0.34, eyeY, 2.2, 0, Math.PI * 2)
      g.arc(px + PLAYER_W * s * 0.66, eyeY, 2.2, 0, Math.PI * 2)
      g.fill()
    }

    g.textAlign = 'center'
    if (messageLeft > 0 && message) {
      g.fillStyle = 'rgba(0,0,0,0.6)'
      g.fillRect(ox, 8, WIDTH * s, 26)
      g.fillStyle = colors.text
      g.font = '13px system-ui, sans-serif'
      g.fillText(message, ox + (WIDTH * s) / 2, 25)
    }
    if (status === 'ready') {
      g.fillStyle = 'rgba(0,0,0,0.7)'
      g.fillRect(ox, H * 0.42, WIDTH * s, 86)
      g.fillStyle = colors.text
      g.font = '600 17px system-ui, sans-serif'
      g.fillText('Left and right to steer', ox + (WIDTH * s) / 2, H * 0.42 + 28)
      g.fillStyle = colors.muted
      g.font = '13px system-ui, sans-serif'
      g.fillText('Or move the mouse and it follows you', ox + (WIDTH * s) / 2, H * 0.42 + 50)
      g.fillText('Off the side and you come back on the other one', ox + (WIDTH * s) / 2, H * 0.42 + 70)
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

const platformClimb: GameModule = { id: 'platform-climb', surface: 'canvas', create }
export default platformClimb
