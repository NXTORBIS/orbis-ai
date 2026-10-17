import type { GameContext, GameInstance, GameModule, GameStatus, Palette } from './engine'
import { createLoop, fitCanvas, palette } from './engine'
import type { StackerState } from '../../../shared/games/stacker'
import { addRubbish, drop, dropMs, isStackerState, levelOf, lock, move, newGame, pieceCells, previewsFor, RUBBISH, rubbishEvery, SHAPE_IDS, shapeCells, turn } from '../../../shared/games/stacker'

interface Saved {
  game: StackerState
  elapsedMs: number
}

/** One colour per shape, so a landed stack still reads as the shapes it was built from. Rubbish is the grey one. */
const shapeColors = (p: Palette): string[] => [p.primary, p.secondary, p.accent, p.good, p.warn, p.danger, p.text, p.muted]

/**
 * Stacker: shapes fall, you turn them and slide them, and a row that fills right across comes out. Four rows at once
 * are worth more than four rows one at a time, which is the whole reason to leave a gap down one side.
 *
 * Playable with the keyboard or by tapping the four parts of the well: the left and right thirds slide the shape, the
 * top middle turns it and the bottom middle drops it. A shape resting on the stack can still be nudged for a moment
 * before it sets, so a last-second slide into a gap works the way your hands expect.
 */
function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 700
  let H = 450
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const blocks = shapeColors(colors)
  const difficulty = ctx.prefs.difficulty
  const previews = previewsFor(difficulty)
  const rubbishEveryPieces = rubbishEvery(difficulty)

  let status: GameStatus = 'ready'
  let state = newGame(10, 20, previews)
  let fall = 0
  let elapsed = 0
  /** How long the shape has been resting on the stack, and how many times that rest has been put off. */
  let resting = 0
  let rests = 0
  let flash = 0
  let note = { text: '', left: 0 }
  let repeat = { dir: 0, left: 0 }
  let lastRubbish = 0
  let lastEmit = 0
  let lastSave = 0

  const level = (): number => levelOf(state.lines)
  const interval = (): number => dropMs(level(), difficulty)

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 100) return
    lastEmit = performance.now()
    ctx.emit({
      status,
      score: state.score,
      level: level(),
      elapsedMs: Math.round(elapsed * 1000),
      difficulty: Math.round((800 / interval()) * 100) / 100,
      hud: [{ label: 'Rows', value: state.lines }, { label: 'Shapes', value: state.pieces }]
    })
  }

  const say = (text: string): void => {
    note = { text, left: 1.6 }
  }

  const saveNow = (): void => {
    lastSave = performance.now()
    if (status === 'running' || status === 'paused') ctx.save?.({ game: state, elapsedMs: Math.round(elapsed * 1000) } satisfies Saved)
  }

  const reset = (): void => {
    status = 'ready'
    state = newGame(10, 20, previews)
    fall = 0
    elapsed = 0
    resting = 0
    rests = 0
    flash = 0
    note = { text: '', left: 0 }
    repeat = { dir: 0, left: 0 }
    lastRubbish = 0
    emit(true)
  }

  const finish = (): void => {
    status = 'over'
    ctx.save?.(null)
    ctx.audio.blip(130, 420, 'sawtooth')
    emit(true)
    ctx.over({ score: state.score, extra: { difficulty } })
  }

  /** Sets the shape into the stack, clears what filled up, and brings in the next one. */
  const land = (): void => {
    const result = lock(state)
    state = result.state
    resting = 0
    rests = 0
    fall = 0
    if (result.cleared) {
      flash = ctx.prefs.reducedMotion ? 0 : 0.18
      ctx.audio.blip(520 + result.cleared * 160, 70 + result.cleared * 30, 'square')
      if (result.perfect) say('Well cleared out')
      else if (result.cleared === 4) say('Four rows at once')
    } else ctx.audio.blip(190, 45, 'triangle', 0.6)
    if (rubbishEveryPieces && state.pieces - lastRubbish >= rubbishEveryPieces && !state.over) {
      lastRubbish = state.pieces
      state = addRubbish(state)
      say('A row came up from the floor')
      ctx.audio.blip(150, 160, 'sawtooth', 0.7)
    }
    if (state.over) finish()
    else saveNow()
  }

  const slide = (dir: -1 | 1): void => {
    const next = move(state, dir, 0)
    if (!next) return
    state = next
    if (resting > 0 && rests < 10) {
      resting = 0
      rests++
    }
    ctx.audio.blip(300, 18, 'square', 0.25)
  }

  const spin = (direction: 1 | -1): void => {
    const next = turn(state, direction)
    if (!next) return
    state = next
    if (resting > 0 && rests < 10) {
      resting = 0
      rests++
    }
    ctx.audio.blip(480, 24, 'triangle', 0.4)
  }

  const slam = (): void => {
    const landing = drop(state)
    state = { ...landing.state, score: landing.state.score + landing.distance * 2 }
    ctx.audio.blip(240, 40, 'square', 0.5)
    land()
  }

  /** Tapping the well: the sides slide, the top middle turns, the bottom middle drops. */
  const tapped = (x: number, y: number): void => {
    const third = W / 3
    if (x < third) return slide(-1)
    if (x > third * 2) return slide(1)
    if (y < H / 2) return spin(1)
    slam()
  }

  const step = (dt: number): void => {
    const input = ctx.input
    const started = status === 'running'
    if (status === 'ready' && (input.taps > 0 || input.pressed('ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyA', 'KeyD', 'KeyW', 'KeyS'))) {
      status = 'running'
      emit(true)
    }
    if (started && input.pressed('KeyP', 'Enter')) {
      input.endStep()
      return instance.pause()
    }
    if (status !== 'running') return input.endStep()

    elapsed += dt
    if (note.left > 0) note.left -= dt
    if (flash > 0) flash -= dt

    if (input.pressed('ArrowLeft', 'KeyA')) {
      slide(-1)
      repeat = { dir: -1, left: 0.17 }
    }
    if (input.pressed('ArrowRight', 'KeyD')) {
      slide(1)
      repeat = { dir: 1, left: 0.17 }
    }
    if (input.pressed('ArrowUp', 'KeyW')) spin(1)
    if (input.pressed('Space')) slam()
    if (input.taps > 0) tapped(input.pointer.x, input.pointer.y)

    // Holding left or right keeps sliding, after a pause, so a long slide is one key rather than ten.
    const held = input.down('ArrowLeft', 'KeyA') ? -1 : input.down('ArrowRight', 'KeyD') ? 1 : 0
    if (held !== repeat.dir) repeat = { dir: held, left: 0.17 }
    else if (held) {
      repeat.left -= dt
      if (repeat.left <= 0) {
        slide(held as -1 | 1)
        repeat.left = 0.045
      }
    }

    // Down makes it fall twelve times faster and pays a point a row; the shape never sets early because of it.
    const soft = input.down('ArrowDown', 'KeyS')
    fall += dt * 1000 * (soft ? 12 : 1)
    while (fall >= interval() && status === 'running') {
      fall -= interval()
      const dropped = move(state, 0, 1)
      if (dropped) {
        state = soft ? { ...dropped, score: dropped.score + 1 } : dropped
        resting = 0
      } else resting += interval() / 1000
    }
    if (!move(state, 0, 1)) {
      resting += dt
      if (resting > 0.4) land()
    }
    emit()
    if (performance.now() - lastSave > 4000) {
      lastSave = performance.now()
      saveNow()
    }
    input.endStep()
  }

  // ---------------------------------------------------------------- drawing

  const geometry = (): { cell: number; ox: number; oy: number; panel: number } => {
    const panel = Math.min(140, Math.max(84, W * 0.22))
    const cell = Math.max(8, Math.floor(Math.min((W - panel - 24) / state.cols, (H - 16) / state.rows)))
    return { cell, ox: Math.floor((W - panel - cell * state.cols) / 2), oy: Math.floor((H - cell * state.rows) / 2), panel }
  }

  const block = (x: number, y: number, cell: number, color: string, solid = true): void => {
    g.fillStyle = color
    if (solid) {
      g.beginPath()
      g.roundRect(x + 1, y + 1, cell - 2, cell - 2, Math.max(2, cell * 0.16))
      g.fill()
      g.fillStyle = 'rgba(255, 255, 255, 0.16)'
      g.fillRect(x + 2, y + 2, cell - 4, Math.max(1, cell * 0.14))
    } else {
      g.strokeStyle = color
      g.lineWidth = 2
      g.beginPath()
      g.roundRect(x + 2, y + 2, cell - 4, cell - 4, Math.max(2, cell * 0.16))
      g.stroke()
    }
  }

  const drawShape = (id: (typeof SHAPE_IDS)[number], x: number, y: number, cell: number): void => {
    const cells = shapeCells(id, 0)
    const minX = Math.min(...cells.map((c) => c[0]))
    const minY = Math.min(...cells.map((c) => c[1]))
    const color = blocks[SHAPE_IDS.indexOf(id)]
    for (const [cx, cy] of cells) block(x + (cx - minX) * cell, y + (cy - minY) * cell, cell, color)
  }

  const draw = (): void => {
    const { cell, ox, oy } = geometry()
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)
    g.fillStyle = colors.bgSoft
    g.fillRect(ox, oy, cell * state.cols, cell * state.rows)
    g.strokeStyle = colors.primary
    g.lineWidth = 2
    g.strokeRect(ox - 1, oy - 1, cell * state.cols + 2, cell * state.rows + 2)

    // The grid, faint, so a gap two columns over is still countable.
    g.strokeStyle = ctx.prefs.highContrast ? 'rgba(255,255,255,0.25)' : 'rgba(160, 210, 255, 0.07)'
    g.lineWidth = 1
    for (let c = 1; c < state.cols; c++) {
      g.beginPath()
      g.moveTo(ox + c * cell, oy)
      g.lineTo(ox + c * cell, oy + cell * state.rows)
      g.stroke()
    }
    for (let r = 1; r < state.rows; r++) {
      g.beginPath()
      g.moveTo(ox, oy + r * cell)
      g.lineTo(ox + cell * state.cols, oy + r * cell)
      g.stroke()
    }

    state.well.forEach((value, i) => {
      if (!value) return
      const x = ox + (i % state.cols) * cell
      const y = oy + Math.floor(i / state.cols) * cell
      block(x, y, cell, value === RUBBISH ? colors.muted : blocks[value - 1])
    })

    if (state.piece && status !== 'over') {
      // Where it would land, so a drop is a decision rather than a guess.
      const landing = drop(state)
      if (landing.distance > 0) for (const [x, y] of pieceCells(landing.state.piece!)) block(ox + x * cell, oy + y * cell, cell, colors.muted, false)
      const color = blocks[SHAPE_IDS.indexOf(state.piece.id)]
      for (const [x, y] of pieceCells(state.piece)) block(ox + x * cell, oy + y * cell, cell, color)
    }

    if (flash > 0) {
      g.fillStyle = 'rgba(255, 255, 255, 0.18)'
      g.fillRect(ox, oy, cell * state.cols, cell * state.rows)
    }

    // The side panel: what is coming.
    const px = ox + cell * state.cols + 16
    g.fillStyle = colors.muted
    g.font = '600 11px system-ui, sans-serif'
    g.textAlign = 'left'
    g.fillText('NEXT', px, oy + 12)
    const small = Math.max(6, Math.floor(cell * 0.6))
    state.queue.slice(0, previews).forEach((id, i) => drawShape(id, px, oy + 24 + i * small * 3.2, small))
    g.fillStyle = colors.text
    g.font = '600 12px system-ui, sans-serif'
    g.fillText(`Level ${level()}`, px, oy + cell * state.rows - 28)
    g.fillStyle = colors.muted
    g.fillText(`${state.lines} rows`, px, oy + cell * state.rows - 12)

    if (status === 'ready') {
      g.fillStyle = colors.text
      g.font = '600 15px system-ui, sans-serif'
      g.textAlign = 'center'
      g.fillText('Arrow keys or tap to start', ox + (cell * state.cols) / 2, oy + cell * state.rows * 0.4)
      g.fillStyle = colors.muted
      g.font = '12px system-ui, sans-serif'
      g.fillText('Up or X turns · Space drops · Down falls faster', ox + (cell * state.cols) / 2, oy + cell * state.rows * 0.4 + 20)
    }
    if (note.left > 0) {
      g.fillStyle = colors.warn
      g.font = '600 13px system-ui, sans-serif'
      g.textAlign = 'center'
      g.fillText(note.text, ox + (cell * state.cols) / 2, oy + 18)
    }
  }

  // X and Z turn the shape as well, and neither is a key the shared input takes.
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return
    if (e.code !== 'KeyX' && e.code !== 'KeyZ') return
    e.preventDefault()
    e.stopPropagation()
    if (status === 'ready') status = 'running'
    if (status === 'running') spin(e.code === 'KeyX' ? 1 : -1)
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
      saveNow()
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
      ctx.save?.(null)
      reset()
      loop.start()
    },
    restore(saved) {
      const s = saved as Saved
      if (!s || !isStackerState(s.game) || s.game.over) return false
      // A game picked up again starts paused, so nothing falls before the player is looking at it.
      loop.stop()
      state = s.game
      elapsed = Math.max(0, Number(s.elapsedMs) || 0) / 1000
      status = 'paused'
      lastRubbish = state.pieces
      fall = 0
      resting = 0
      emit(true)
      draw()
      return true
    },
    destroy() {
      loop.stop()
      saveNow()
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

const stacker: GameModule = { id: 'stacker', surface: 'canvas', create }
export default stacker
