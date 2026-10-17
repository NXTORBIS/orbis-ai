import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import type { C4Board, C4Player } from '../../../shared/games/connectFour'
import { C4_COLS, C4_LEVELS, C4_ROWS, c4Score, cellIndex, chooseMove, columnHeight, columnOpen, dropAt, isC4Board, legalColumns, newC4Board } from '../../../shared/games/connectFour'

interface Saved {
  board: C4Board
  turn: C4Player
  first: C4Player
}

const YOU: C4Player = 1
const THEM: C4Player = 2

/**
 * Four in a Row against the computer. Counters fall to the bottom of the column you drop them in; four in a line, in
 * any direction, wins.
 *
 * The opponent searches ahead properly rather than following rules of thumb: two moves on easy, five on normal and
 * seven on hard. Easy also plays a bad move about half the time, which is what makes it winnable by someone learning
 * the game — a search that never slips beats a beginner every time, however shallow it is. Whoever goes first
 * alternates from game to game, because going first in this game is a real advantage.
 *
 * A game in progress is saved, so closing the page in the middle of one does not lose it.
 */
function create(ctx: GameContext): GameInstance {
  const surface = ctx.root.querySelector('.game-surface')!
  const root = document.createElement('div')
  root.className = `c4${ctx.prefs.reducedMotion ? ' still' : ''}`
  const say = document.createElement('p')
  say.className = 'c4-say'
  say.setAttribute('role', 'status')
  say.setAttribute('aria-live', 'polite')
  const boardEl = document.createElement('div')
  boardEl.className = 'c4-board'
  const hint = document.createElement('p')
  hint.className = 'c4-hint'
  hint.textContent = 'Click a column to drop a counter, or move with the left and right arrows and press Enter.'
  root.append(say, boardEl, hint)
  surface.appendChild(root)

  const level = C4_LEVELS[ctx.prefs.difficulty]
  let board = newC4Board()
  let turn: C4Player = YOU
  let first: C4Player = YOU
  let aim = 3
  let status: GameStatus = 'ready'
  let thinking = false
  let justDropped = -1
  let timer = 0

  const outcome = (): 'win' | 'draw' | 'loss' | null => (board.winner === YOU ? 'win' : board.winner === THEM ? 'loss' : board.draw ? 'draw' : null)

  const emit = (): void =>
    ctx.emit({
      status,
      score: outcome() ? c4Score(outcome()!, board.moves, ctx.prefs.difficulty) : 0,
      elapsedMs: 0,
      difficulty: level.depth,
      hud: [
        { label: 'Counters', value: board.moves },
        { label: 'Looks ahead', value: `${level.depth} moves` }
      ]
    })

  const render = (): void => {
    const cells: HTMLElement[] = []
    for (let row = C4_ROWS - 1; row >= 0; row--)
      for (let col = 0; col < C4_COLS; col++) {
        const i = cellIndex(col, row)
        const slot = document.createElement('span')
        const who = board.cells[i]
        slot.className = `c4-slot${who === YOU ? ' you' : who === THEM ? ' them' : ''}${board.line.includes(i) ? ' won' : ''}${i === justDropped ? ' dropped' : ''}`
        slot.dataset.col = String(col)
        slot.setAttribute('role', 'img')
        slot.setAttribute('aria-label', `Column ${col + 1}, row ${row + 1}: ${who === YOU ? 'yours' : who === THEM ? 'theirs' : 'empty'}`)
        cells.push(slot)
      }
    const aimRow = document.createElement('div')
    aimRow.className = 'c4-aim'
    for (let col = 0; col < C4_COLS; col++) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `c4-col${col === aim ? ' aimed' : ''}${columnOpen(board, col) ? '' : ' full'}`
      button.dataset.col = String(col)
      button.disabled = !columnOpen(board, col) || turn !== YOU || status === 'over' || status === 'paused'
      button.setAttribute('aria-label', `Drop in column ${col + 1}${columnOpen(board, col) ? '' : ', full'}`)
      aimRow.appendChild(button)
    }
    boardEl.replaceChildren(aimRow, ...cells)
    emit()
  }

  const save = (): void => {
    if (status === 'running' && !outcome() && board.moves) ctx.save?.({ board, turn, first } satisfies Saved)
    else ctx.save?.(null)
  }

  const finish = (): void => {
    status = 'over'
    thinking = false
    window.clearTimeout(timer)
    ctx.save?.(null)
    const result = outcome()!
    say.textContent = result === 'win' ? 'Four in a row. You win.' : result === 'loss' ? 'Four in a row — to the computer.' : 'The board is full. A draw.'
    if (result === 'win') ctx.audio.blip(880, 320, 'triangle')
    else if (result === 'loss') ctx.audio.blip(150, 380, 'sawtooth')
    else ctx.audio.blip(440, 260, 'sine')
    render()
    ctx.over({ score: c4Score(result, board.moves, ctx.prefs.difficulty), extra: { difficulty: ctx.prefs.difficulty } })
  }

  const play = (col: number, who: C4Player): boolean => {
    const next = dropAt(board, col, who)
    if (!next) return false
    justDropped = cellIndex(col, columnHeight(board.cells, col))
    board = next
    ctx.audio.blip(who === YOU ? 520 : 360, 70, 'square', 0.6)
    turn = who === YOU ? THEM : YOU
    if (outcome()) {
      finish()
      return true
    }
    say.textContent = turn === YOU ? 'Your turn.' : 'Thinking…'
    render()
    save()
    if (turn === THEM) think()
    return true
  }

  /** The search blocks for a moment at depth seven, so the player's counter is drawn before it starts. */
  const think = (): void => {
    thinking = true
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      if (status !== 'running' || turn !== THEM || !legalColumns(board).length) return
      thinking = false
      play(chooseMove(board, THEM, ctx.prefs.difficulty), THEM)
    }, 320)
  }

  const drop = (col: number): void => {
    if (status === 'ready') status = 'running'
    if (status !== 'running' || turn !== YOU || thinking) return
    if (!play(col, YOU)) ctx.audio.blip(180, 90, 'square', 0.5)
  }

  const onClick = (e: MouseEvent): void => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-col]')
    if (!el?.dataset.col) return
    aim = Number(el.dataset.col)
    drop(aim)
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey) return
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') aim = (aim + C4_COLS - 1) % C4_COLS
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') aim = (aim + 1) % C4_COLS
    else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault()
      e.stopPropagation()
      return drop(aim)
    } else if (/^(Digit|Numpad)[1-7]$/.test(e.code)) {
      e.preventDefault()
      e.stopPropagation()
      aim = Number(e.code.slice(-1)) - 1
      return drop(aim)
    } else return
    e.preventDefault()
    e.stopPropagation()
    render()
  }
  boardEl.addEventListener('click', onClick)
  ctx.root.addEventListener('keydown', onKey)

  const begin = (keepFirst: boolean): void => {
    window.clearTimeout(timer)
    board = newC4Board()
    if (!keepFirst) first = first === YOU ? THEM : YOU
    turn = first
    aim = 3
    justDropped = -1
    thinking = false
    status = 'running'
    say.textContent = turn === YOU ? 'You go first. Drop a counter.' : 'The computer goes first.'
    render()
    if (turn === THEM) think()
  }

  return {
    start() {
      first = YOU
      begin(true)
    },
    restart() {
      ctx.save?.(null)
      begin(false)
    },
    pause() {
      if (status !== 'running') return
      status = 'paused'
      window.clearTimeout(timer)
      say.textContent = 'Paused.'
      save()
      render()
    },
    resume() {
      if (status !== 'paused') return
      status = 'running'
      say.textContent = turn === YOU ? 'Your turn.' : 'Thinking…'
      render()
      if (turn === THEM) think()
    },
    restore(saved) {
      const s = saved as Saved | null
      if (!s || !isC4Board(s.board) || s.board.winner || s.board.draw) return false
      if (s.turn !== YOU && s.turn !== THEM) return false
      board = s.board
      turn = s.turn
      first = s.first === THEM ? THEM : YOU
      status = 'running'
      aim = 3
      justDropped = -1
      say.textContent = turn === YOU ? 'Carrying on. Your turn.' : 'Carrying on. Thinking…'
      render()
      if (turn === THEM) think()
      return true
    },
    destroy() {
      save()
      window.clearTimeout(timer)
      boardEl.removeEventListener('click', onClick)
      ctx.root.removeEventListener('keydown', onKey)
      root.remove()
    },
    resize() {
      // The board is a CSS grid: it takes the space it is given.
    }
  }
}

const connectFour: GameModule = { id: 'connect-four', surface: 'dom', create }
export default connectFour
