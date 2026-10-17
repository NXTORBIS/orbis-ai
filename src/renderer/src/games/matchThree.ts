import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import type { Board, MatchSave } from '../../../shared/games/matchThree'
import { areNeighbours, chainPoints, clearWith, collapse, dealBoard, hasMove, isMatchSave, levelTarget, MATCH_LEVELS, matchGroups, reshuffle, swapped } from '../../../shared/games/matchThree'
import { createLoop, fitCanvas, palette } from './engine'

/**
 * Gem Swap: swap two gems that are next to each other to line up three or more. What is left falls, and whatever
 * lines up on the way down pays double, then triple.
 *
 * The board is never dealt with a match already on it, and never dealt without a swap worth making -- and if the
 * swaps run out mid-game the same gems are shuffled rather than new ones handed over. Four in a line leaves a charged
 * gem behind: clear that and it takes its whole row and column, and any other charged gem it reaches goes off too.
 *
 * Swaps are counted, not timed. Reaching a level's target hands some back.
 */

type Phase = { kind: 'idle' } | { kind: 'swap'; a: number; b: number; t: number; back: boolean } | { kind: 'clear'; cells: number[]; t: number } | { kind: 'fall'; fell: number[]; t: number }

const SHAPES = 7

function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 700
  let H = 450
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const level = MATCH_LEVELS[ctx.prefs.difficulty]
  const { rows, cols } = level
  // Reduced motion means the pieces appear where they belong instead of sliding there. Nothing is lost but the slide.
  const pace = ctx.prefs.reducedMotion ? 0.001 : 1

  const gemColors = [colors.primary, colors.accent, colors.good, colors.warn, colors.secondary, colors.danger, colors.text]

  let status: GameStatus = 'ready'
  let board: Board = dealBoard(rows, cols, level.kinds)
  let phase: Phase = { kind: 'idle' }
  let chain = 0
  let bestChain = 0
  let score = 0
  let moves = level.moves
  let stage = 1
  let cursor = 0
  let picked: number | null = null
  let dragFrom: number | null = null
  let wasDown = false
  let message = 'Swap two gems that touch to line up three.'
  let flash = 0
  let elapsed = 0
  let lastEmit = 0

  // Floored at a size a finger can still hit, so a very small panel scrolls off rather than drawing a board of nothing.
  const cellSize = (): number => Math.max(12, Math.floor(Math.min((W - 24) / cols, (H - 56) / rows)))
  const originX = (): number => Math.floor((W - cellSize() * cols) / 2)
  const originY = (): number => Math.floor((H - cellSize() * rows) / 2) + 14

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 100) return
    lastEmit = performance.now()
    ctx.emit({
      status,
      score,
      level: stage,
      elapsedMs: Math.round(elapsed * 1000),
      difficulty: stage,
      hud: [
        { label: 'Swaps', value: moves },
        { label: 'Target', value: levelTarget(stage) }
      ]
    })
  }

  const keep = (): void => {
    if (status === 'running' || status === 'ready') ctx.save?.({ board, rows, cols, kinds: level.kinds, score, moves, level: stage, difficulty: ctx.prefs.difficulty } satisfies MatchSave)
  }

  const finish = (): void => {
    status = 'over'
    ctx.save?.(null)
    ctx.audio.blip(160, 320, 'sawtooth')
    emit(true)
    ctx.over({ score, extra: { difficulty: ctx.prefs.difficulty, bestStreak: bestChain } })
  }

  // ------------------------------------------------------------ resolving a move

  /** Clears what matches, makes a charged gem out of a run of four or more, and pays for the chain. */
  const resolve = (from: number | null): void => {
    const groups = matchGroups(board, rows, cols)
    if (!groups.length) {
      chain = 0
      if (!hasMove(board, rows, cols)) {
        board = reshuffle(board, rows, cols)
        message = 'No swaps left on that board, so the same gems were shuffled.'
        ctx.audio.blip(300, 200, 'triangle')
      }
      phase = { kind: 'idle' }
      if (moves <= 0) finish()
      else keep()
      return
    }
    chain++
    bestChain = Math.max(bestChain, chain)
    const seeds = new Set<number>()
    for (const group of groups) for (const index of group) seeds.add(index)
    const cleared = clearWith(board, rows, cols, seeds)
    const detonated = [...cleared].filter((index) => board[index].charged).length
    // A run of four or more leaves one gem behind, charged. It stays where the swap was made when it can.
    for (const group of groups) {
      if (group.length < 4) continue
      const spot = from !== null && group.includes(from) ? from : group[Math.floor(group.length / 2)]
      cleared.delete(spot)
      board[spot] = { kind: board[spot].kind, charged: true }
    }
    const gained = chainPoints(cleared.size, chain, detonated)
    score += gained
    message = chain > 1 ? `Chain ${chain}: ${gained} points.` : `${cleared.size} gems, ${gained} points.`
    flash = 0.4
    ctx.audio.blip(520 + chain * 110, 70, 'square', 0.6)
    if (score >= levelTarget(stage)) {
      stage++
      moves += level.reward
      message = `Level ${stage}. ${level.reward} more swaps.`
      ctx.audio.blip(1200, 220, 'sine')
    }
    phase = { kind: 'clear', cells: [...cleared], t: 0 }
    emit(true)
  }

  const trySwap = (a: number, b: number): void => {
    if (!areNeighbours(a, b, cols) || status !== 'running' || phase.kind !== 'idle') return
    picked = null
    dragFrom = null
    const next = swapped(board, a, b)
    const works = matchGroups(next, rows, cols).length > 0
    board = next
    if (works) {
      moves--
      message = ''
    } else {
      message = 'That swap lines nothing up, so it costs you nothing.'
      ctx.audio.blip(240, 60, 'triangle', 0.4)
    }
    phase = { kind: 'swap', a, b, t: 0, back: !works }
    emit(true)
  }

  const step = (dt: number): void => {
    const input = ctx.input
    if (status === 'running' && input.pressed('KeyP', 'Enter')) {
      input.endStep()
      return instance.pause()
    }
    if (status === 'ready' && (input.taps > 0 || input.pressed('Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'))) {
      status = 'running'
      emit(true)
    }
    if (status !== 'running') return input.endStep()
    elapsed += dt
    if (flash > 0) flash = Math.max(0, flash - dt)

    // Keyboard: a cursor you move about, and Space to pick a gem up and put it next to another.
    if (input.pressed('ArrowLeft', 'KeyA') && cursor % cols > 0) cursor--
    if (input.pressed('ArrowRight', 'KeyD') && cursor % cols < cols - 1) cursor++
    if (input.pressed('ArrowUp', 'KeyW') && cursor >= cols) cursor -= cols
    if (input.pressed('ArrowDown', 'KeyS') && cursor < rows * cols - cols) cursor += cols
    if (input.pressed('Space')) {
      if (picked === null) {
        picked = cursor
        message = 'Now move to a gem beside it and press Space again.'
      } else if (picked === cursor) picked = null
      else if (areNeighbours(picked, cursor, cols)) trySwap(picked, cursor)
      else picked = cursor
    }

    // Pointer: click one gem then its neighbour, or drag one onto its neighbour.
    const size = cellSize()
    const col = Math.floor((input.pointer.x - originX()) / size)
    const row = Math.floor((input.pointer.y - originY()) / size)
    const over = col >= 0 && row >= 0 && col < cols && row < rows ? row * cols + col : null
    if (input.taps > 0 && over !== null) {
      cursor = over
      dragFrom = over
      if (picked === null) picked = over
      else if (picked === over) picked = null
      else if (areNeighbours(picked, over, cols)) trySwap(picked, over)
      else picked = over
    }
    if (input.pointer.down && dragFrom !== null && over !== null && over !== dragFrom && areNeighbours(dragFrom, over, cols)) trySwap(dragFrom, over)
    if (!input.pointer.down && wasDown) dragFrom = null
    wasDown = input.pointer.down

    // The animations, one phase at a time.
    if (phase.kind === 'swap') {
      phase.t += dt * pace
      if (phase.t >= 0.14) {
        if (phase.back) {
          // A swap that lines nothing up slides back where it came from, so the player sees why nothing happened.
          board = swapped(board, phase.a, phase.b)
          phase = { kind: 'swap', a: phase.a, b: phase.b, t: 0, back: false }
        } else resolve(phase.b)
      }
    } else if (phase.kind === 'clear') {
      phase.t += dt * pace
      if (phase.t >= 0.16) {
        const cleared = new Set(phase.cells)
        const fallen = collapse(board, rows, cols, cleared, level.kinds)
        board = fallen.board
        phase = { kind: 'fall', fell: fallen.fell, t: 0 }
      }
    } else if (phase.kind === 'fall') {
      phase.t += dt * pace
      if (phase.t >= 0.2) resolve(null)
    }
    emit()
    input.endStep()
  }

  // ------------------------------------------------------------ drawing

  const shape = (x: number, y: number, r: number, kind: number): void => {
    const sides = kind % SHAPES
    g.beginPath()
    if (sides === 0) g.arc(x, y, r, 0, Math.PI * 2)
    else if (sides === 1) g.roundRect(x - r, y - r, r * 2, r * 2, r * 0.3)
    else if (sides === 6) {
      // A star, so the seventh gem is not just another ring of the same shape.
      for (let i = 0; i < 10; i++) {
        const radius = i % 2 ? r * 0.48 : r
        const angle = -Math.PI / 2 + (i * Math.PI) / 5
        const px = x + Math.cos(angle) * radius
        const py = y + Math.sin(angle) * radius
        if (i === 0) g.moveTo(px, py)
        else g.lineTo(px, py)
      }
      g.closePath()
    } else {
      const points = sides + 1
      for (let i = 0; i < points; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI * 2) / points
        const px = x + Math.cos(angle) * r
        const py = y + Math.sin(angle) * r
        if (i === 0) g.moveTo(px, py)
        else g.lineTo(px, py)
      }
      g.closePath()
    }
    g.fill()
  }

  const draw = (): void => {
    const size = cellSize()
    const ox = originX()
    const oy = originY()
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)
    g.fillStyle = colors.bgSoft
    g.fillRect(ox, oy, size * cols, size * rows)

    const clearing = phase.kind === 'clear' ? new Set(phase.cells) : null
    const clearU = phase.kind === 'clear' ? Math.min(1, phase.t / 0.16) : 0
    const fallU = phase.kind === 'fall' ? Math.min(1, phase.t / 0.2) : 1
    const swapU = phase.kind === 'swap' ? Math.min(1, phase.t / 0.14) : 1

    for (let i = 0; i < board.length; i++) {
      const gem = board[i]
      if (!gem.kind) continue
      let x = ox + (i % cols) * size + size / 2
      let y = oy + Math.floor(i / cols) * size + size / 2
      let scale = 1
      if (phase.kind === 'swap' && (i === phase.a || i === phase.b)) {
        const other = i === phase.a ? phase.b : phase.a
        const fromX = ox + (other % cols) * size + size / 2
        const fromY = oy + Math.floor(other / cols) * size + size / 2
        x = fromX + (x - fromX) * swapU
        y = fromY + (y - fromY) * swapU
      }
      if (phase.kind === 'fall' && phase.fell[i]) y -= phase.fell[i] * size * (1 - fallU)
      if (clearing?.has(i)) scale = 1 - clearU
      if (scale <= 0.02) continue
      g.fillStyle = gemColors[(gem.kind - 1) % gemColors.length]
      shape(x, y, size * 0.36 * scale, gem.kind)
      if (gem.charged) {
        g.strokeStyle = colors.text
        g.lineWidth = Math.max(2, size * 0.06)
        g.beginPath()
        g.arc(x, y, size * 0.44 * scale, 0, Math.PI * 2)
        g.stroke()
      }
    }

    if (picked !== null) {
      g.strokeStyle = colors.warn
      g.lineWidth = 3
      g.strokeRect(ox + (picked % cols) * size + 2, oy + Math.floor(picked / cols) * size + 2, size - 4, size - 4)
    }
    g.strokeStyle = colors.primary
    g.lineWidth = 2
    g.strokeRect(ox + (cursor % cols) * size + 1, oy + Math.floor(cursor / cols) * size + 1, size - 2, size - 2)

    g.fillStyle = flash > 0 ? colors.warn : colors.muted
    g.font = '600 13px system-ui, sans-serif'
    g.textAlign = 'center'
    g.fillText(status === 'ready' ? 'Click a gem, or use the arrow keys and Space, to start' : message, W / 2, oy - 6)
  }

  const loop = createLoop(step, draw)

  const fresh = (): void => {
    board = dealBoard(rows, cols, level.kinds)
    phase = { kind: 'idle' }
    status = 'ready'
    chain = 0
    bestChain = 0
    score = 0
    moves = level.moves
    stage = 1
    cursor = 0
    picked = null
    dragFrom = null
    flash = 0
    elapsed = 0
    message = 'Swap two gems that touch to line up three.'
    emit(true)
  }

  const instance: GameInstance = {
    start() {
      fresh()
      loop.start()
      ctx.audio.resumeMusic()
    },
    pause() {
      if (status !== 'running') return
      status = 'paused'
      loop.stop()
      ctx.audio.pauseMusic()
      keep()
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
      fresh()
      loop.start()
    },
    restore(saved) {
      if (!isMatchSave(saved) || saved.rows !== rows || saved.cols !== cols || saved.kinds !== level.kinds) return false
      board = saved.board.map((gem) => ({ kind: gem.kind, charged: gem.charged }))
      score = Math.max(0, Math.round(saved.score) || 0)
      moves = Math.max(1, Math.round(saved.moves) || 1)
      stage = Math.max(1, Math.round(saved.level) || 1)
      phase = { kind: 'idle' }
      message = 'Carrying on where you left off.'
      emit(true)
      return true
    },
    destroy() {
      keep()
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

const matchThree: GameModule = { id: 'match-three', surface: 'canvas', create }
export default matchThree
