import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import { createLoop, fitCanvas, palette } from './engine'
import type { PipeBoard, PipeSave } from '../../../shared/games/pipes'
import { boardPlan, boardScore, connected, E, filledCount, floodDepths, generatePipes, isPipeSave, N, rotateMask, S, SIDES, turnsToSolution, W as WEST } from '../../../shared/games/pipes'

/**
 * Pipeworks: turn the pieces until the water runs from the tap to the tank.
 *
 * The board is made by laying real plumbing across every square and then turning every piece away from it, so there
 * is always a way back. The water is shown arriving one piece at a time, which is also the hint: a pipe that stays
 * dry is a pipe the water never reached, and you can see exactly where it stopped.
 *
 * Click a piece to turn it, right-click to turn it back. With the keyboard, the arrows move the marker and Enter
 * turns the piece under it.
 */
function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 700
  let H = 450
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const plan = boardPlan(ctx.prefs.difficulty)

  let status: GameStatus = 'ready'
  let index = 0
  let made = generatePipes(plan[0].cols, plan[0].rows)
  let board: PipeBoard = made.board
  let solution = made.solution
  let par = turnsToSolution(board.tiles, solution)
  let turns = 0
  let score = 0
  let elapsed = 0
  let since = 0
  let cursor = 0
  let running = false
  let note = { text: '', left: 0 }
  let lastEmit = 0
  /** The pause between a board finishing and the next one, so the water is seen running. Cleared on the way out. */
  let nextTimer = 0

  const depths = (): Map<number, number> => floodDepths(board)
  let wet = depths()

  const say = (text: string, seconds = 2.6): void => {
    note = { text, left: seconds }
  }

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 120) return
    lastEmit = performance.now()
    ctx.emit({
      status,
      score,
      level: index + 1,
      elapsedMs: Math.round(elapsed * 1000),
      difficulty: 1 + index * 0.4,
      hud: [
        { label: 'Board', value: `${index + 1} of ${plan.length}` },
        { label: 'Turns', value: turns },
        { label: 'Pipes filled', value: `${wet.size} of ${board.tiles.length}` }
      ]
    })
  }

  const saveNow = (): void => {
    if (status === 'running' || status === 'paused') ctx.save?.({ round: index, cols: board.cols, rows: board.rows, tiles: board.tiles, solution, turns, score } satisfies PipeSave)
  }

  const openBoard = (at: number): void => {
    index = at
    made = generatePipes(plan[at].cols, plan[at].rows)
    board = made.board
    solution = made.solution
    par = turnsToSolution(board.tiles, solution)
    turns = 0
    cursor = 0
    since = 0
    running = false
    wet = depths()
    emit(true)
  }

  const reset = (): void => {
    status = 'ready'
    score = 0
    elapsed = 0
    note = { text: '', left: 0 }
    openBoard(0)
    say('Turn the pipes until the water gets across')
  }

  const finish = (): void => {
    status = 'over'
    ctx.save?.(null)
    emit(true)
    ctx.over({ score, extra: { difficulty: ctx.prefs.difficulty } })
  }

  const boardDone = (): void => {
    const everything = filledCount(board) === board.tiles.length
    const gained = boardScore(par, turns, everything)
    score += gained
    running = true
    ctx.audio.blip(740, 240, 'sine')
    if (index + 1 >= plan.length) {
      say(`Water all the way through. ${gained} points, and that was the last board.`, 4)
      emit(true)
      finish()
      return
    }
    say(everything ? `${gained} points, and not a dry pipe left` : `${gained} points`, 2.2)
    window.clearTimeout(nextTimer)
    nextTimer = window.setTimeout(() => {
      if (status !== 'running' && status !== 'paused') return
      openBoard(index + 1)
      saveNow()
    }, ctx.prefs.reducedMotion ? 450 : 1100)
  }

  const turnPiece = (at: number, direction: 1 | -1): void => {
    if (status === 'ready') status = 'running'
    if (status !== 'running' || running || at < 0 || at >= board.tiles.length) return
    const tiles = [...board.tiles]
    tiles[at] = rotateMask(tiles[at], direction)
    board = { ...board, tiles }
    turns++
    cursor = at
    since = 0
    wet = depths()
    ctx.audio.blip(360 + (wet.size % 6) * 40, 28, 'triangle', 0.35)
    if (connected(board)) boardDone()
    else {
      emit()
      saveNow()
    }
  }

  const geometry = (): { cell: number; ox: number; oy: number } => {
    const cell = Math.max(18, Math.floor(Math.min((W - 90) / board.cols, (H - 70) / board.rows)))
    return { cell, ox: Math.floor((W - cell * board.cols) / 2), oy: Math.floor((H - cell * board.rows) / 2) }
  }

  const at = (x: number, y: number): number => {
    const { cell, ox, oy } = geometry()
    const cx = Math.floor((x - ox) / cell)
    const cy = Math.floor((y - oy) / cell)
    if (cx < 0 || cy < 0 || cx >= board.cols || cy >= board.rows) return -1
    return cy * board.cols + cx
  }

  const step = (dt: number): void => {
    const input = ctx.input
    if (status === 'ready' && (input.taps > 0 || input.pressed('ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Space'))) {
      status = 'running'
      emit(true)
    }
    if (status === 'running' && input.pressed('KeyP')) {
      input.endStep()
      return instance.pause()
    }
    if (status !== 'running') return input.endStep()
    elapsed += dt
    since += dt
    if (note.left > 0) note.left -= dt

    if (input.pressed('ArrowLeft', 'KeyA') && cursor % board.cols > 0) cursor--
    if (input.pressed('ArrowRight', 'KeyD') && cursor % board.cols < board.cols - 1) cursor++
    if (input.pressed('ArrowUp', 'KeyW') && cursor >= board.cols) cursor -= board.cols
    if (input.pressed('ArrowDown', 'KeyS') && cursor + board.cols < board.tiles.length) cursor += board.cols
    if (input.pressed('Enter', 'Space')) turnPiece(cursor, 1)
    if (input.taps > 0) {
      const hit = at(input.pointer.x, input.pointer.y)
      if (hit >= 0) turnPiece(hit, 1)
    }
    emit()
    input.endStep()
  }

  // ---------------------------------------------------------------- drawing

  const drawPipe = (cx: number, cy: number, cell: number, mask: number, filled: boolean, dash: number): void => {
    const thickness = Math.max(4, cell * 0.26)
    g.lineCap = 'round'
    g.lineWidth = thickness
    g.strokeStyle = filled ? colors.primary : ctx.prefs.highContrast ? colors.text : '#4a5a78'
    for (const side of SIDES) {
      if (!(mask & side)) continue
      const dx = side === E ? 1 : side === WEST ? -1 : 0
      const dy = side === S ? 1 : side === N ? -1 : 0
      g.beginPath()
      g.moveTo(cx, cy)
      g.lineTo(cx + (dx * cell) / 2, cy + (dy * cell) / 2)
      g.stroke()
    }
    g.fillStyle = filled ? colors.primary : ctx.prefs.highContrast ? colors.text : '#4a5a78'
    g.beginPath()
    g.arc(cx, cy, thickness * 0.5, 0, Math.PI * 2)
    g.fill()
    if (filled && dash > 0) {
      // Water on the move: short marks sliding along the pipe it has filled.
      g.strokeStyle = 'rgba(255, 255, 255, 0.55)'
      g.lineWidth = Math.max(1.5, thickness * 0.22)
      g.setLineDash([Math.max(3, cell * 0.12), Math.max(5, cell * 0.2)])
      g.lineDashOffset = -dash
      for (const side of SIDES) {
        if (!(mask & side)) continue
        const dx = side === E ? 1 : side === WEST ? -1 : 0
        const dy = side === S ? 1 : side === N ? -1 : 0
        g.beginPath()
        g.moveTo(cx, cy)
        g.lineTo(cx + (dx * cell) / 2, cy + (dy * cell) / 2)
        g.stroke()
      }
      g.setLineDash([])
      g.lineDashOffset = 0
    }
  }

  const draw = (): void => {
    const { cell, ox, oy } = geometry()
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)
    const dash = ctx.prefs.reducedMotion ? 0 : (elapsed * cell * 1.6) % 1000

    for (let i = 0; i < board.tiles.length; i++) {
      const x = ox + (i % board.cols) * cell
      const y = oy + Math.floor(i / board.cols) * cell
      g.fillStyle = colors.bgSoft
      g.fillRect(x + 1, y + 1, cell - 2, cell - 2)
      const depth = wet.get(i)
      // The water is shown arriving rather than appearing, so it is clear where it stopped.
      const reached = depth !== undefined && (ctx.prefs.reducedMotion || since > depth * 0.05)
      drawPipe(x + cell / 2, y + cell / 2, cell, board.tiles[i], reached, reached && running ? dash : 0)
      if (i === cursor && status !== 'over') {
        g.strokeStyle = colors.warn
        g.lineWidth = 2
        g.strokeRect(x + 2, y + 2, cell - 4, cell - 4)
      }
    }

    // The tap on the left of the first square, the tank on the right of the last.
    const tapY = oy + Math.floor(board.source / board.cols) * cell + cell / 2
    const tankY = oy + Math.floor(board.sink / board.cols) * cell + cell / 2
    g.fillStyle = colors.good
    g.fillRect(ox - 16, tapY - cell * 0.18, 14, cell * 0.36)
    g.fillStyle = connected(board) ? colors.good : colors.muted
    g.fillRect(ox + cell * board.cols + 2, tankY - cell * 0.26, 16, cell * 0.52)
    g.fillStyle = colors.muted
    g.font = '600 10px system-ui, sans-serif'
    g.textAlign = 'center'
    g.fillText('TAP', ox - 9, tapY - cell * 0.28)
    g.fillText('TANK', ox + cell * board.cols + 10, tankY - cell * 0.34)

    g.textAlign = 'center'
    g.fillStyle = colors.muted
    g.font = '600 12px system-ui, sans-serif'
    g.fillText(`Board ${index + 1} of ${plan.length} · ${turns} turns · ${par} would do it`, W / 2, Math.max(14, oy - 12))
    if (note.left > 0) {
      g.fillStyle = running ? colors.good : colors.warn
      g.font = '600 13px system-ui, sans-serif'
      g.fillText(note.text, W / 2, oy + cell * board.rows + 24)
    } else {
      g.fillStyle = colors.muted
      g.font = '12px system-ui, sans-serif'
      g.fillText('Click to turn a piece · right-click turns it back · Enter turns the marked one', W / 2, oy + cell * board.rows + 24)
    }
  }

  // Right-click turns a piece back, which the shared input has no notion of.
  const onContext = (e: MouseEvent): void => {
    e.preventDefault()
    const rect = canvas.getBoundingClientRect()
    const hit = at(e.clientX - rect.left, e.clientY - rect.top)
    if (hit >= 0) turnPiece(hit, -1)
  }
  canvas.addEventListener('contextmenu', onContext)

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
      window.clearTimeout(nextTimer)
      ctx.save?.(null)
      reset()
      loop.start()
    },
    restore(saved) {
      const s = saved as PipeSave
      if (!isPipeSave(s) || s.round >= plan.length) return false
      loop.stop()
      window.clearTimeout(nextTimer)
      index = s.round
      board = { cols: s.cols, rows: s.rows, tiles: [...s.tiles], source: 0, sink: s.cols * s.rows - 1 }
      solution = [...s.solution]
      par = turnsToSolution(board.tiles, solution)
      turns = Math.max(0, Number(s.turns) || 0)
      score = Math.max(0, Number(s.score) || 0)
      cursor = 0
      since = 99
      running = connected(board)
      wet = depths()
      status = 'paused'
      say('Picked up where you left off')
      emit(true)
      draw()
      return true
    },
    destroy() {
      loop.stop()
      window.clearTimeout(nextTimer)
      saveNow()
      canvas.removeEventListener('contextmenu', onContext)
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

const pipes: GameModule = { id: 'pipes', surface: 'canvas', create }
export default pipes
