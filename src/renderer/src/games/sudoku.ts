import type { GameContext, GameInstance, GameModule } from './engine'
import type { SudokuGrid, SudokuSave } from '../../../shared/games/sudoku'
import { CELLS, conflictsIn, generateSudoku, isSudokuSave, peersOf, SUDOKU_LEVELS, sudokuScore, wrongCells } from '../../../shared/games/sudoku'

/**
 * Sudoku: every row, column and box holds one to nine, once each.
 *
 * The puzzle is made fresh every time, and every clue taken out of it was only taken out while exactly one answer was
 * still possible -- so the grid on screen has one answer and the Check button can never be arguing with a player who
 * is right.
 *
 * Pencil notes go in the corners of a square, numbers that clash with one already written are marked (and that marking
 * can be switched off), and a hint fills the square you are on. Keyboard: arrows move, 1 to 9 write, 0 or Backspace
 * erases, N switches notes, H gives a hint, C checks.
 */
function create(ctx: GameContext): GameInstance {
  const surface = ctx.root.querySelector('.game-surface')!
  const root = document.createElement('div')
  root.className = 'sdk'
  surface.appendChild(root)

  const difficulty = ctx.prefs.difficulty
  const level = SUDOKU_LEVELS[difficulty]

  let made = generateSudoku(difficulty)
  let entries: SudokuGrid = made.puzzle.slice()
  let notes: number[] = Array(CELLS).fill(0)
  let focus = Math.max(0, made.puzzle.findIndex((v) => v === 0))
  let noteMode = false
  let marking = level.markMistakes
  let mistakes = 0
  let help = 0
  let hintsLeft = level.hints
  let seconds = 0
  let clock = 0
  let paused = false
  let done = false
  let checked: number[] = []

  // ------------------------------------------------------------ the screen

  const bar = document.createElement('div')
  bar.className = 'sdk-bar'
  const note = document.createElement('p')
  note.className = 'sdk-note'
  const grid = document.createElement('div')
  grid.className = 'sdk-grid'
  const pad = document.createElement('div')
  pad.className = 'sdk-pad'
  root.append(bar, grid, pad, note)

  const cells: HTMLButtonElement[] = []
  const values: HTMLSpanElement[] = []
  const noteMarks: HTMLSpanElement[][] = []
  for (let i = 0; i < CELLS; i++) {
    const cell = document.createElement('button')
    cell.type = 'button'
    cell.tabIndex = -1
    cell.dataset.index = String(i)
    const value = document.createElement('span')
    value.className = 'sdk-value'
    const marks = document.createElement('span')
    marks.className = 'sdk-notes'
    const row: HTMLSpanElement[] = []
    for (let n = 1; n <= 9; n++) {
      const mark = document.createElement('span')
      marks.appendChild(mark)
      row.push(mark)
    }
    cell.append(value, marks)
    grid.appendChild(cell)
    cells.push(cell)
    values.push(value)
    noteMarks.push(row)
  }

  const padButtons: HTMLButtonElement[] = []
  for (let n = 1; n <= 9; n++) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'sdk-key'
    button.dataset.digit = String(n)
    const face = document.createElement('b')
    face.textContent = String(n)
    const left = document.createElement('i')
    button.append(face, left)
    pad.appendChild(button)
    padButtons.push(button)
  }
  const tool = (label: string, title: string): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'sdk-tool'
    button.textContent = label
    button.title = title
    bar.appendChild(button)
    return button
  }
  const eraseButton = tool('Erase', 'Rub out the number in this square (0 or Backspace)')
  const notesButton = tool('Notes', 'Write small pencil numbers instead (N)')
  const hintButton = tool('Hint', 'Fill this square in for you (H)')
  const checkButton = tool('Check', 'Mark anything written in wrongly (C)')
  const markButton = tool('Marking', 'Mark a number that clashes as soon as it is written')

  // ------------------------------------------------------------ what it says about itself

  const left = (): number => entries.filter((v) => v === 0).length
  const score = (): number => (done ? sudokuScore(difficulty, seconds, mistakes, help) : 0)

  const emit = (): void =>
    ctx.emit({
      status: done ? 'over' : paused ? 'paused' : 'running',
      score: score(),
      elapsedMs: seconds * 1000,
      difficulty: 1,
      hud: [
        { label: 'Left', value: left() },
        { label: 'Mistakes', value: mistakes },
        { label: 'Help', value: help },
        { label: 'Time', value: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }
      ]
    })

  const say = (text: string): void => {
    note.textContent = text
  }

  const render = (): void => {
    const clash = marking ? new Set(conflictsIn(entries)) : new Set<number>()
    const wrong = new Set(checked)
    const peers = new Set(peersOf(focus))
    const same = entries[focus]
    const counts = Array(10).fill(0)
    for (const value of entries) counts[value]++

    for (let i = 0; i < CELLS; i++) {
      const value = entries[i]
      const classes = ['sdk-cell']
      if (made.given[i]) classes.push('given')
      if (i === focus) classes.push('focused')
      else if (peers.has(i)) classes.push('peer')
      if (value && same && value === same) classes.push('same')
      if (clash.has(i) && !made.given[i]) classes.push('clash')
      if (wrong.has(i)) classes.push('wrong')
      if (i % 3 === 2 && i % 9 !== 8) classes.push('edge-right')
      if (Math.floor(i / 9) % 3 === 2 && i < 72) classes.push('edge-bottom')
      cells[i].className = classes.join(' ')
      values[i].textContent = value ? String(value) : ''
      for (let n = 1; n <= 9; n++) {
        const on = !value && Boolean(notes[i] & (1 << n))
        noteMarks[i][n - 1].textContent = on ? String(n) : ''
      }
      cells[i].setAttribute('aria-label', `Row ${Math.floor(i / 9) + 1} column ${(i % 9) + 1}: ${value ? value : 'empty'}${made.given[i] ? ', given' : ''}`)
    }
    padButtons.forEach((button, index) => {
      const digit = index + 1
      button.classList.toggle('full', counts[digit] >= 9)
      button.querySelector('i')!.textContent = counts[digit] >= 9 ? '' : String(9 - counts[digit])
    })
    notesButton.classList.toggle('on', noteMode)
    markButton.classList.toggle('on', marking)
    hintButton.disabled = hintsLeft <= 0 || done
    hintButton.textContent = `Hint${hintsLeft > 0 ? ` (${hintsLeft})` : ''}`
    checkButton.disabled = done
    eraseButton.disabled = done
    emit()
  }

  // ------------------------------------------------------------ playing

  const startClock = (): void => {
    window.clearInterval(clock)
    clock = window.setInterval(() => {
      if (paused || done) return
      seconds++
      emit()
      if (seconds % 10 === 0) keep()
    }, 1000)
  }

  const keep = (): void => {
    if (!done) ctx.save?.({ puzzle: made.puzzle, solution: made.solution, entries, notes, seconds, mistakes, hints: help, difficulty } satisfies SudokuSave)
  }

  const finish = (): void => {
    done = true
    window.clearInterval(clock)
    ctx.save?.(null)
    ctx.audio.blip(880, 160, 'sine')
    ctx.audio.blip(1320, 240, 'sine')
    render()
    ctx.over({ score: score(), extra: { difficulty } })
  }

  const write = (digit: number): void => {
    if (paused || done || made.given[focus]) {
      if (made.given[focus]) say('That number came with the puzzle, so it stays.')
      return
    }
    checked = []
    if (noteMode) {
      notes[focus] ^= 1 << digit
      ctx.audio.blip(520, 25, 'triangle', 0.4)
      render()
      keep()
      return
    }
    entries[focus] = entries[focus] === digit ? 0 : digit
    notes[focus] = 0
    if (entries[focus]) {
      // Clear the note from every square that can no longer hold it.
      for (const peer of peersOf(focus)) notes[peer] &= ~(1 << digit)
      if (entries[focus] !== made.solution[focus]) {
        if (marking) {
          mistakes++
          say('That one clashes. Marking is on, so you can see it.')
          ctx.audio.blip(180, 120, 'sawtooth', 0.5)
        } else ctx.audio.blip(440, 30, 'square', 0.4)
      } else {
        say('')
        ctx.audio.blip(660, 30, 'square', 0.4)
      }
    }
    render()
    if (entries.every((v, i) => v === made.solution[i])) finish()
    else keep()
  }

  const erase = (): void => {
    if (paused || done || made.given[focus]) return
    entries[focus] = 0
    notes[focus] = 0
    checked = []
    ctx.audio.blip(300, 25, 'triangle', 0.4)
    render()
    keep()
  }

  const hint = (): void => {
    if (paused || done) return
    if (hintsLeft <= 0) return say('No hints left on this puzzle.')
    let target = entries[focus] === made.solution[focus] ? -1 : focus
    if (target < 0 || made.given[target]) target = entries.findIndex((v, i) => v !== made.solution[i] && !made.given[i])
    if (target < 0) return
    focus = target
    entries[target] = made.solution[target]
    notes[target] = 0
    hintsLeft--
    help++
    checked = []
    say(`That square is a ${made.solution[target]}.`)
    ctx.audio.blip(990, 90, 'sine')
    render()
    if (entries.every((v, i) => v === made.solution[i])) finish()
    else keep()
  }

  const check = (): void => {
    if (paused || done) return
    help++
    checked = wrongCells(entries, made.solution)
    say(checked.length ? `${checked.length} ${checked.length === 1 ? 'square is' : 'squares are'} wrong, marked in red.` : 'Everything written in so far is right.')
    ctx.audio.blip(checked.length ? 240 : 760, 120, 'triangle')
    render()
  }

  const move = (by: number): void => {
    const next = focus + by
    if (next < 0 || next >= CELLS) return
    // Moving left or right stays on its own row.
    if (Math.abs(by) === 1 && Math.floor(next / 9) !== Math.floor(focus / 9)) return
    focus = next
    render()
  }

  // ------------------------------------------------------------ hands and keys

  const onClick = (e: MouseEvent): void => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.sdk-cell')
    if (cell) {
      focus = Number(cell.dataset.index)
      render()
      return
    }
    const key = (e.target as HTMLElement).closest<HTMLElement>('.sdk-key')
    if (key) write(Number(key.dataset.digit))
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey || paused || done) return
    const digit = /^(Digit|Numpad)([0-9])$/.exec(e.code)
    if (digit) {
      const value = Number(digit[2])
      if (value === 0) erase()
      else write(value)
    } else if (e.code === 'ArrowLeft') move(-1)
    else if (e.code === 'ArrowRight') move(1)
    else if (e.code === 'ArrowUp') move(-9)
    else if (e.code === 'ArrowDown') move(9)
    else if (e.code === 'Backspace' || e.code === 'Delete') erase()
    else if (e.code === 'KeyN') {
      noteMode = !noteMode
      say(noteMode ? 'Pencil notes: numbers go in small.' : 'Writing numbers in.')
      render()
    } else if (e.code === 'KeyH') hint()
    else if (e.code === 'KeyC') check()
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  root.addEventListener('click', onClick)
  eraseButton.addEventListener('click', erase)
  hintButton.addEventListener('click', hint)
  checkButton.addEventListener('click', check)
  notesButton.addEventListener('click', () => {
    noteMode = !noteMode
    render()
  })
  markButton.addEventListener('click', () => {
    marking = !marking
    say(marking ? 'A number that clashes will be marked.' : 'Nothing will be marked. Mistakes are yours to find.')
    render()
  })
  ctx.root.addEventListener('keydown', onKey)

  const fresh = (): void => {
    made = generateSudoku(difficulty)
    entries = made.puzzle.slice()
    notes = Array(CELLS).fill(0)
    focus = Math.max(0, made.puzzle.findIndex((v) => v === 0))
    mistakes = 0
    help = 0
    hintsLeft = level.hints
    seconds = 0
    paused = false
    done = false
    checked = []
    marking = level.markMistakes
    say(`${made.clues} squares to start with.${level.markMistakes ? '' : ' Nothing is marked for you on hard.'}`)
    startClock()
    render()
  }

  return {
    start: fresh,
    restart() {
      ctx.save?.(null)
      fresh()
    },
    pause() {
      if (done || paused) return
      paused = true
      keep()
      emit()
    },
    resume() {
      if (!paused) return
      paused = false
      emit()
    },
    restore(saved) {
      if (!isSudokuSave(saved) || saved.difficulty !== difficulty) return false
      made = { puzzle: saved.puzzle, solution: saved.solution, given: saved.puzzle.map((v) => v !== 0), clues: saved.puzzle.filter((v) => v !== 0).length, difficulty }
      entries = saved.entries.slice()
      notes = saved.notes.slice()
      seconds = Math.max(0, Math.round(saved.seconds) || 0)
      mistakes = Math.max(0, Math.round(saved.mistakes) || 0)
      help = Math.max(0, Math.round(saved.hints) || 0)
      hintsLeft = Math.max(0, level.hints - help)
      focus = Math.max(0, entries.findIndex((v) => v === 0))
      checked = []
      done = false
      say('Carrying on where you left off.')
      startClock()
      render()
      return true
    },
    destroy() {
      keep()
      window.clearInterval(clock)
      ctx.root.removeEventListener('keydown', onKey)
      root.remove()
    },
    resize() {
      // The grid and the pad are sized by the stylesheet, so there is nothing to work out here.
    }
  }
}

const sudoku: GameModule = { id: 'sudoku', surface: 'dom', create }
export default sudoku
