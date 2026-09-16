import type { GameContext, GameInstance, GameModule } from './engine'
import type { MineBoard } from '../../../shared/gameLogic'
import { chord, isBoard, MINE_LEVELS, newBoard, reveal, toggleFlag } from '../../../shared/gameLogic'

interface Saved {
  board: MineBoard
  seconds: number
}

/**
 * Minesweeper: reveal every safe cell. The first reveal is always safe; numbers count neighbouring mines. Right-click
 * (or F, or a long press) flags; clicking a satisfied number opens its neighbours. Keyboard: arrows move, Enter or Space
 * reveals, F flags. Progress can be saved and continued.
 */
function create(ctx: GameContext): GameInstance {
  const surface = ctx.root.querySelector('.game-surface')!
  const root = document.createElement('div')
  root.className = 'ms'
  surface.appendChild(root)

  const level = MINE_LEVELS[ctx.prefs.difficulty]
  let board = newBoard(level.rows, level.cols, level.mines)
  let seconds = 0
  let clock = 0
  let focus = 0
  let paused = false
  let pressTimer = 0
  let longPressed = false

  const flags = (): number => board.cells.filter((c) => c.flagged).length
  const started = (): boolean => board.placed
  const over = (): boolean => board.lost || board.won
  const score = (): number => (board.won ? Math.max(10, Math.round(level.mines * 30 - seconds)) : board.cells.filter((c) => c.revealed && !c.mine).length)

  const emit = (): void =>
    ctx.emit({ status: over() ? 'over' : paused ? 'paused' : started() ? 'running' : 'ready', score: score(), elapsedMs: seconds * 1000, difficulty: 1, hud: [{ label: 'Mines', value: level.mines - flags() }, { label: 'Time', value: `${seconds}s` }] })

  const save = (): void => {
    if (started() && !over()) ctx.save?.({ board, seconds } satisfies Saved)
  }

  const render = (): void => {
    root.style.setProperty('--ms-cols', String(board.cols))
    root.innerHTML = ''
    board.cells.forEach((cell, i) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.tabIndex = -1
      el.className = `ms-cell${cell.revealed ? ' open' : ''}${cell.flagged ? ' flag' : ''}${cell.revealed && cell.mine ? ' mine' : ''}${i === focus ? ' focused' : ''}${cell.revealed && cell.adjacent ? ` n${cell.adjacent}` : ''}`
      el.textContent = cell.revealed ? (cell.mine ? '✹' : cell.adjacent ? String(cell.adjacent) : '') : cell.flagged ? '⚑' : ''
      el.setAttribute('aria-label', cell.revealed ? (cell.mine ? 'Mine' : cell.adjacent ? `${cell.adjacent} nearby` : 'Empty') : cell.flagged ? 'Flagged' : 'Hidden')
      el.dataset.index = String(i)
      root.appendChild(el)
    })
    emit()
  }

  const finish = (): void => {
    window.clearInterval(clock)
    ctx.save?.(null)
    if (board.won) ctx.audio.blip(1040, 300, 'sine')
    else ctx.audio.blip(110, 400, 'sawtooth')
    ctx.over({ score: score(), extra: { difficulty: ctx.prefs.difficulty } })
  }

  const act = (i: number, kind: 'reveal' | 'flag'): void => {
    if (paused || over()) return
    focus = i
    if (kind === 'flag') {
      board = toggleFlag(board, i)
      ctx.audio.blip(400, 30, 'square', 0.4)
    } else {
      const wasStarted = started()
      board = board.cells[i].revealed ? chord(board, i) : reveal(board, i)
      if (!wasStarted && started()) clock = window.setInterval(() => {
        if (paused || over()) return
        seconds++
        emit()
        if (seconds % 5 === 0) save()
      }, 1000)
      if (!over()) ctx.audio.blip(620, 25, 'triangle', 0.4)
    }
    render()
    if (over()) finish()
    else save()
  }

  const indexOf = (e: Event): number | null => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.ms-cell')
    return el ? Number(el.dataset.index) : null
  }
  const onClick = (e: MouseEvent): void => {
    const i = indexOf(e)
    if (i === null || longPressed) return
    act(i, 'reveal')
  }
  const onContext = (e: MouseEvent): void => {
    const i = indexOf(e)
    if (i === null) return
    e.preventDefault()
    act(i, 'flag')
  }
  const onDown = (e: PointerEvent): void => {
    longPressed = false
    if (e.pointerType !== 'touch') return
    const i = indexOf(e)
    if (i === null) return
    pressTimer = window.setTimeout(() => {
      longPressed = true
      act(i, 'flag')
    }, 450)
  }
  const onUp = (): void => window.clearTimeout(pressTimer)
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey) return
    const moveBy: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -board.cols, ArrowDown: board.cols }
    if (e.code in moveBy) focus = Math.min(board.cells.length - 1, Math.max(0, focus + moveBy[e.code]))
    else if (e.code === 'Enter' || e.code === 'Space') return (e.preventDefault(), e.stopPropagation(), act(focus, 'reveal'))
    else if (e.code === 'KeyF') return (e.preventDefault(), e.stopPropagation(), act(focus, 'flag'))
    else return
    e.preventDefault()
    e.stopPropagation()
    render()
  }
  root.addEventListener('click', onClick)
  root.addEventListener('contextmenu', onContext)
  root.addEventListener('pointerdown', onDown)
  root.addEventListener('pointerup', onUp)
  ctx.root.addEventListener('keydown', onKey)

  const fresh = (): void => {
    window.clearInterval(clock)
    board = newBoard(level.rows, level.cols, level.mines)
    seconds = focus = 0
    paused = false
    render()
  }

  return {
    start: fresh,
    restart() {
      fresh()
      ctx.save?.(null)
    },
    pause() {
      if (over() || paused) return
      paused = true
      save()
      emit()
    },
    resume() {
      if (!paused) return
      paused = false
      emit()
    },
    restore(saved) {
      const s = saved as Saved
      if (!s || !isBoard(s.board) || s.board.rows !== level.rows || s.board.cols !== level.cols || s.board.lost || s.board.won) return false
      board = s.board
      seconds = Number(s.seconds) || 0
      window.clearInterval(clock)
      if (board.placed)
        clock = window.setInterval(() => {
          if (paused || over()) return
          seconds++
          emit()
        }, 1000)
      render()
      return true
    },
    destroy() {
      save()
      window.clearInterval(clock)
      window.clearTimeout(pressTimer)
      ctx.root.removeEventListener('keydown', onKey)
      root.remove()
    },
    resize() {
      // CSS grid.
    }
  }
}

const minesweeper: GameModule = { id: 'minesweeper', surface: 'dom', create }
export default minesweeper
