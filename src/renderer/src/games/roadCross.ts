import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import { createLoop, fitCanvas, palette } from './engine'
import type { Action, Death, Level } from '../../../shared/games/roadCross.ts'
import { ALL_HOMES_POINTS, COLS, HOME_COLS, HOME_ROW, MEDIAN_ROW, MOVE_TICKS, ROWS, ROW_POINTS, START_COL, TICK_HZ, crossingScore, divePhase, diving, makeLevel, occupied, tickCrossing } from '../../../shared/games/roadCross.ts'

/**
 * Road Cross: five lanes of traffic, a strip of grass, then a river where the only dry squares are the logs and the
 * turtles -- and the turtles go under. Fill all five home bays at the top and the next crossing is faster.
 *
 * Everything that decides whether you live is in `src/shared/games/roadCross.ts`, where it is whole squares and whole
 * thirtieths of a second, and where a search proves every generated crossing can actually be made. This file moves the
 * clock on and draws the result.
 *
 * The one thing worth knowing about the drawing: a car or a log slides into its square over the first part of its step
 * and then sits there, so nothing is ever drawn in a square the rules have not put it in yet. That slide stays on when
 * motion is reduced -- it is how you read the traffic, not decoration. The shimmer on the water and the squash of a hop
 * are decoration, and those go.
 */

type Phase = 'crossing' | 'dying' | 'landed'

function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 700
  let H = 450
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const reduced = ctx.prefs.reducedMotion

  let status: GameStatus = 'ready'
  let level: Level = makeLevel(Date.now() & 0xffff, ctx.prefs.difficulty)
  let stage = 1
  let row = 0
  let col = START_COL
  let tick = 0
  let tickFloat = 0
  let crossTick = 0
  let bestRow = 0
  let lives = 3
  let homes = HOME_COLS.map(() => false)
  let score = 0
  let homesTotal = 0
  let elapsed = 0
  let queued: Action | null = null
  let phase: Phase = 'crossing'
  let phaseLeft = 0
  let death: Death | null = null
  let hopFrom: { row: number; col: number } | null = null
  let hopLeft = 0
  let lastEmit = 0

  const HOP_SECONDS = 0.09

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 100) return
    lastEmit = performance.now()
    const left = Math.max(0, Math.ceil((level.timerTicks - crossTick) / TICK_HZ))
    ctx.emit({
      status,
      score,
      level: stage,
      lives,
      elapsedMs: Math.round(elapsed * 1000),
      difficulty: stage,
      hud: [{ label: 'Homes', value: `${homes.filter(Boolean).length}/${HOME_COLS.length}` }, { label: 'Time', value: `${left}s` }]
    })
  }

  const reset = (keepStage: boolean): void => {
    if (!keepStage) {
      stage = 1
      level = makeLevel((Date.now() + Math.floor(Math.random() * 1e6)) & 0xffffff, ctx.prefs.difficulty)
      lives = 3
      score = 0
      homesTotal = 0
      homes = HOME_COLS.map(() => false)
    }
    status = 'ready'
    row = 0
    col = START_COL
    tick = 0
    tickFloat = 0
    crossTick = 0
    bestRow = 0
    elapsed = 0
    queued = null
    phase = 'crossing'
    phaseLeft = 0
    death = null
    hopFrom = null
    hopLeft = 0
    emit(true)
  }

  const backToKerb = (): void => {
    row = 0
    col = START_COL
    crossTick = 0
    // The clock the drawing reads has to come back to the clock the rules read, or the traffic jumps.
    tickFloat = tick
    bestRow = 0
    queued = null
    hopFrom = null
    hopLeft = 0
    phase = 'crossing'
  }

  const finish = (): void => {
    status = 'over'
    emit(true)
    ctx.over({ score, extra: { bestStreak: homesTotal, difficulty: ctx.prefs.difficulty } })
  }

  const kill = (why: Death): void => {
    death = why
    phase = 'dying'
    phaseLeft = reduced ? 0.4 : 0.8
    lives--
    ctx.audio.blip(why === 'traffic' ? 90 : 170, 320, 'sawtooth')
  }

  const nextStage = (): void => {
    stage++
    homes = HOME_COLS.map(() => false)
    level = makeLevel((level.seed * 7919 + stage * 104729) & 0xffffff, ctx.prefs.difficulty)
    tick = 0
    tickFloat = 0
    backToKerb()
  }

  /** One thirtieth of a second: the queued move, the rows, then what that leaves the player standing on. */
  const advance = (): void => {
    const action = queued ?? 'wait'
    const result = tickCrossing(level, { row, col }, tick, action)
    const taken = tick % MOVE_TICKS === 0
    if (taken) queued = null
    tick = result.tick
    crossTick++
    if (result.blocked) ctx.audio.blip(150, 40, 'square', 0.3)
    if (result.home !== null) {
      // The bay pays for itself and for whatever was left on the clock. One already filled is simply refused.
      if (homes[result.home]) {
        ctx.audio.blip(200, 80, 'square', 0.4)
        backToKerb()
        return
      }
      homes[result.home] = true
      homesTotal++
      score += crossingScore({ rowsForward: 0, homesFilled: 1, ticksLeft: level.timerTicks - crossTick })
      ctx.audio.blip(880, 140, 'sine')
      if (homes.every(Boolean)) {
        score += ALL_HOMES_POINTS
        ctx.audio.blip(1320, 260, 'sine')
        phase = 'landed'
        phaseLeft = reduced ? 0.5 : 1
        emit(true)
        return
      }
      backToKerb()
      emit(true)
      return
    }
    if (result.row !== row || result.col !== col) {
      if (taken && action !== 'wait') {
        hopFrom = { row, col }
        hopLeft = reduced ? 0 : HOP_SECONDS
        ctx.audio.blip(520, 35, 'triangle', 0.5)
      }
      row = result.row
      col = result.col
    }
    if (row > bestRow) {
      score += (row - bestRow) * ROW_POINTS
      bestRow = row
    }
    if (result.death) return kill(result.death)
    if (crossTick >= level.timerTicks) kill('time')
  }

  /** A bay that is already filled is a wall, so the hop towards it is never taken in the first place. */
  const intoAFilledBay = (action: Action): boolean => action === 'up' && row === HOME_ROW - 1 && homes[HOME_COLS.indexOf(col)] === true

  const want = (action: Action): void => {
    if (intoAFilledBay(action)) {
      ctx.audio.blip(150, 40, 'square', 0.3)
      return
    }
    queued = action
  }

  const readInput = (): void => {
    const input = ctx.input
    if (input.pressed('ArrowUp', 'KeyW')) want('up')
    else if (input.pressed('ArrowDown', 'KeyS')) want('down')
    else if (input.pressed('ArrowLeft', 'KeyA')) want('left')
    else if (input.pressed('ArrowRight', 'KeyD')) want('right')
    else if (input.taps > 0) {
      // A tap beside the player hops that way: whichever of the two distances is the bigger decides.
      const cell = cellSize()
      const here = { x: originX() + (col + 0.5) * cell, y: originY() + (ROWS - 1 - row + 0.5) * cell }
      const dx = input.pointer.x - here.x
      const dy = input.pointer.y - here.y
      if (Math.abs(dx) > Math.abs(dy)) want(dx < 0 ? 'left' : 'right')
      else want(dy < 0 ? 'up' : 'down')
    }
  }

  const step = (dt: number): void => {
    const input = ctx.input
    readInput()
    if (status === 'running' && input.pressed('KeyP', 'Enter')) {
      input.endStep()
      return instance.pause()
    }
    if (status === 'ready' && queued) status = 'running'
    if (status !== 'running') return input.endStep()
    elapsed += dt
    if (hopLeft > 0) hopLeft = Math.max(0, hopLeft - dt)
    if (phase !== 'crossing') {
      // Nothing moves while somebody is dying or celebrating, on screen or in the rules.
      phaseLeft -= dt
      queued = null
      tickFloat = tick
      if (phaseLeft <= 0) {
        if (phase === 'landed') nextStage()
        else if (lives <= 0) {
          finish()
          return input.endStep()
        } else {
          death = null
          backToKerb()
        }
      }
      emit()
      return input.endStep()
    }
    tickFloat += dt * TICK_HZ
    while (tick < Math.floor(tickFloat) && phase === 'crossing' && status === 'running') advance()
    emit()
    input.endStep()
  }

  // ---------------------------------------------------------------- drawing

  const cellSize = (): number => Math.floor(Math.min(W / COLS, (H - 6) / ROWS))
  const originX = (): number => Math.floor((W - cellSize() * COLS) / 2)
  const originY = (): number => Math.floor((H - cellSize() * ROWS) / 2)

  /**
   * Where a row's things are drawn, as a fraction of a square away from the square the rules say they are in. It is
   * never positive: a car slides in over the first part of its step and then sits still, so nothing is ever drawn in a
   * square it has not reached. Drawing it the other way round -- gliding towards the next square -- would put a car on
   * top of the player a tenth of a second before it hit them.
   */
  const slide = (ticksPerStep: number, dir: number): number => {
    if (ticksPerStep <= 0) return 0
    const within = (tickFloat % ticksPerStep) / ticksPerStep
    return (Math.min(1, within / 0.6) - 1) * dir
  }

  const roundRect = (x: number, y: number, w: number, h: number, r: number): void => {
    g.beginPath()
    g.roundRect(x, y, w, h, r)
    g.fill()
  }

  const draw = (): void => {
    const cell = cellSize()
    const ox = originX()
    const oy = originY()
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)
    const yOf = (r: number): number => oy + (ROWS - 1 - r) * cell

    level.lanes.forEach((lane, r) => {
      const y = yOf(r)
      // The row itself.
      if (lane.kind === 'kerb') {
        g.fillStyle = ctx.prefs.highContrast ? '#003300' : '#13301d'
        g.fillRect(ox, y, cell * COLS, cell)
      } else if (lane.kind === 'road') {
        g.fillStyle = ctx.prefs.highContrast ? '#111111' : '#15171d'
        g.fillRect(ox, y, cell * COLS, cell)
        g.strokeStyle = 'rgba(255,255,255,0.12)'
        g.lineWidth = 1
        g.setLineDash([cell * 0.3, cell * 0.3])
        g.beginPath()
        g.moveTo(ox, y + cell)
        g.lineTo(ox + cell * COLS, y + cell)
        g.stroke()
        g.setLineDash([])
      } else if (lane.kind === 'river') {
        g.fillStyle = ctx.prefs.highContrast ? '#000066' : '#0b2340'
        g.fillRect(ox, y, cell * COLS, cell)
        if (!reduced) {
          g.strokeStyle = 'rgba(120, 200, 255, 0.18)'
          g.lineWidth = 1
          g.beginPath()
          for (let x = 0; x < COLS * cell; x += cell / 2) {
            const wobble = Math.sin(elapsed * 2 + x * 0.08 + r) * cell * 0.08
            g.moveTo(ox + x, y + cell * 0.5 + wobble)
            g.lineTo(ox + x + cell * 0.35, y + cell * 0.5 + wobble)
          }
          g.stroke()
        }
      } else {
        g.fillStyle = ctx.prefs.highContrast ? '#003300' : '#132a1a'
        g.fillRect(ox, y, cell * COLS, cell)
      }

      // What is on it.
      if (lane.kind === 'home') {
        HOME_COLS.forEach((home, i) => {
          g.fillStyle = homes[i] ? colors.good : colors.bgSoft
          roundRect(ox + home * cell + 2, y + 2, cell - 4, cell - 4, cell * 0.25)
          if (homes[i]) {
            g.fillStyle = colors.bg
            g.font = `600 ${Math.floor(cell * 0.5)}px system-ui, sans-serif`
            g.textAlign = 'center'
            g.textBaseline = 'middle'
            g.fillText('✓', ox + (home + 0.5) * cell, y + cell * 0.55)
          }
        })
        return
      }
      if (lane.kind === 'kerb' || !lane.mask.length) return
      const shift = slide(lane.ticksPerStep, lane.dir)
      const under = diving(lane, tick)
      const sinking = divePhase(lane, tick)
      for (let c = -1; c <= COLS; c++) {
        const inSquare = ((c % COLS) + COLS) % COLS
        if (!occupied(lane, inSquare, tick)) continue
        const x = ox + (c + shift) * cell
        if (x + cell < ox - cell || x > ox + cell * COLS + cell) continue
        if (lane.kind === 'road') {
          g.fillStyle = lane.dir > 0 ? colors.danger : colors.warn
          roundRect(x + 1, y + cell * 0.18, cell - 2, cell * 0.64, cell * 0.18)
          g.fillStyle = 'rgba(0,0,0,0.35)'
          roundRect(x + cell * (lane.dir > 0 ? 0.6 : 0.12), y + cell * 0.3, cell * 0.28, cell * 0.4, cell * 0.1)
        } else if (lane.float === 'turtle') {
          const r = cell * (under ? 0.18 : 0.34 - sinking * 0.1)
          g.fillStyle = under ? 'rgba(80, 200, 160, 0.25)' : sinking > 0 ? colors.warn : colors.good
          g.beginPath()
          g.arc(x + cell / 2, y + cell / 2, r, 0, Math.PI * 2)
          g.fill()
        } else {
          g.fillStyle = ctx.prefs.highContrast ? '#996600' : '#5b3b22'
          roundRect(x, y + cell * 0.14, cell, cell * 0.72, cell * 0.12)
          g.fillStyle = 'rgba(0,0,0,0.2)'
          g.fillRect(x, y + cell * 0.45, cell, 1)
        }
      }
    })

    // The player.
    const lane = level.lanes[row]
    const ride = lane?.kind === 'river' ? slide(lane.ticksPerStep, lane.dir) : 0
    const hop = hopFrom && hopLeft > 0 ? hopLeft / HOP_SECONDS : 0
    const px = ox + ((hopFrom ? col + (hopFrom.col - col) * hop : col) + ride + 0.5) * cell
    const py = yOf(hopFrom ? row + (hopFrom.row - row) * hop : row) + cell * 0.5
    const squash = reduced ? 1 : 1 + Math.sin((1 - hop) * Math.PI) * 0.12
    if (phase !== 'dying' || Math.floor(elapsed * 10) % 2 === 0) {
      g.fillStyle = phase === 'dying' ? colors.danger : colors.primary
      g.beginPath()
      g.ellipse(px, py, cell * 0.34 * squash, cell * 0.34 / squash, 0, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = colors.bg
      g.beginPath()
      g.arc(px - cell * 0.1, py - cell * 0.08, cell * 0.055, 0, Math.PI * 2)
      g.arc(px + cell * 0.1, py - cell * 0.08, cell * 0.055, 0, Math.PI * 2)
      g.fill()
    }

    // The clock, along the bottom of the board.
    const left = Math.max(0, 1 - crossTick / level.timerTicks)
    g.fillStyle = colors.bgSoft
    g.fillRect(ox, oy + cell * ROWS + 2, cell * COLS, 4)
    g.fillStyle = left < 0.25 ? colors.danger : colors.primary
    g.fillRect(ox, oy + cell * ROWS + 2, cell * COLS * left, 4)

    g.textAlign = 'center'
    g.textBaseline = 'alphabetic'
    if (status === 'ready') {
      g.fillStyle = 'rgba(0,0,0,0.6)'
      g.fillRect(ox, yOf(MEDIAN_ROW) - cell * 0.6, cell * COLS, cell * 2.2)
      g.fillStyle = colors.text
      g.font = '600 17px system-ui, sans-serif'
      g.fillText('Arrows or WASD to hop one square', W / 2, yOf(MEDIAN_ROW) + cell * 0.4)
      g.fillStyle = colors.muted
      g.font = '14px system-ui, sans-serif'
      g.fillText('Tap or click beside yourself to hop that way', W / 2, yOf(MEDIAN_ROW) + cell * 1.2)
    }
    if (phase === 'dying' && death) {
      g.fillStyle = colors.danger
      g.font = '600 17px system-ui, sans-serif'
      g.fillText(death === 'traffic' ? 'Hit by a car' : death === 'water' ? 'Into the water' : death === 'swept' ? 'Carried off the edge' : 'Out of time', W / 2, yOf(MEDIAN_ROW) + cell * 0.4)
    }
    if (phase === 'landed') {
      g.fillStyle = colors.good
      g.font = '600 18px system-ui, sans-serif'
      g.fillText('All five home — here comes a harder crossing', W / 2, yOf(MEDIAN_ROW) + cell * 0.4)
    }
  }

  const loop = createLoop(step, draw)
  const instance: GameInstance = {
    start() {
      reset(false)
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
      reset(false)
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

const roadCross: GameModule = { id: 'road-cross', surface: 'canvas', create }
export default roadCross
