import type { GameContext, GameInstance, GameModule } from './engine'
import type { NonogramSave, Picture } from '../../../shared/games/nonogram'
import { cluesOf, generateNonogram, inkCount, isNonogramSave, lineSolved, NONOGRAM_LEVELS, nonogramScore, pictureDone } from '../../../shared/games/nonogram'

/**
 * Picture Logic: the numbers down the side and along the top say how the filled squares run, and the picture is
 * whatever fits them.
 *
 * Every puzzle is checked before it is handed over -- its own clues are counted, and a picture is only used when those
 * clues allow exactly one. Two pictures from one set of numbers would mean the player could work perfectly and still
 * be told they are wrong.
 *
 * Click to fill, right-click to cross out, and drag to do a run of squares at once. The two buttons above the board
 * change what a plain click does, which is the only way to cross a square out on a touchscreen. Keyboard: arrows move,
 * Space fills, F crosses out. Filling a square that should be empty counts against you; on easy and normal it is
 * crossed out for you, and on hard it is left exactly as you put it.
 */
function create(ctx: GameContext): GameInstance {
  const surface = ctx.root.querySelector('.game-surface')!
  const root = document.createElement('div')
  root.className = 'nono'
  surface.appendChild(root)

  const difficulty = ctx.prefs.difficulty
  const size = NONOGRAM_LEVELS[difficulty].size
  const strict = difficulty === 'hard'

  let made = generateNonogram(difficulty)
  let picture: Picture = made.picture
  let marks: number[] = Array(size * size).fill(0)
  let focus = 0
  let wrong = 0
  let seconds = 0
  let clock = 0
  let paused = false
  let done = false
  let painting: number | null = null
  /** What a plain click does: 1 fills, 2 crosses out. A right-click always crosses out, whatever this says. */
  let mode = 1

  const bar = document.createElement('div')
  bar.className = 'nono-bar'
  const board = document.createElement('div')
  board.className = 'nono-board'
  const note = document.createElement('p')
  note.className = 'nono-note'
  root.append(bar, board, note)

  // Two buttons rather than only a right-click, because a right-click is not something a touchscreen has.
  const fillButton = document.createElement('button')
  fillButton.type = 'button'
  fillButton.className = 'nono-tool'
  fillButton.textContent = 'Fill'
  fillButton.title = 'Clicking fills a square in (Space)'
  const crossButton = document.createElement('button')
  crossButton.type = 'button'
  crossButton.className = 'nono-tool'
  crossButton.textContent = 'Cross out'
  crossButton.title = 'Clicking crosses a square out (F, or a right-click)'
  bar.append(fillButton, crossButton)

  const rowClues: HTMLElement[] = []
  const colClues: HTMLElement[] = []
  const cells: HTMLButtonElement[] = []

  const build = (): void => {
    board.replaceChildren()
    board.style.setProperty('--nono-size', String(size))
    rowClues.length = 0
    colClues.length = 0
    cells.length = 0
    const corner = document.createElement('div')
    corner.className = 'nono-corner'
    corner.textContent = String(inkCount(picture))
    corner.title = 'How many squares are filled in altogether'
    board.appendChild(corner)
    for (let c = 0; c < size; c++) {
      const clue = document.createElement('div')
      clue.className = 'nono-clue down'
      for (const run of made.puzzle.cols[c].length ? made.puzzle.cols[c] : [0]) {
        const span = document.createElement('span')
        span.textContent = String(run)
        clue.appendChild(span)
      }
      board.appendChild(clue)
      colClues.push(clue)
    }
    for (let r = 0; r < size; r++) {
      const clue = document.createElement('div')
      clue.className = 'nono-clue across'
      for (const run of made.puzzle.rows[r].length ? made.puzzle.rows[r] : [0]) {
        const span = document.createElement('span')
        span.textContent = String(run)
        clue.appendChild(span)
      }
      board.appendChild(clue)
      rowClues.push(clue)
      for (let c = 0; c < size; c++) {
        const cell = document.createElement('button')
        cell.type = 'button'
        cell.tabIndex = -1
        cell.className = 'nono-cell'
        cell.dataset.index = String(r * size + c)
        board.appendChild(cell)
        cells.push(cell)
      }
    }
  }

  const rowIndexes = (r: number): number[] => Array.from({ length: size }, (_, c) => r * size + c)
  const colIndexes = (c: number): number[] => Array.from({ length: size }, (_, r) => r * size + c)

  const emit = (): void =>
    ctx.emit({
      status: done ? 'over' : paused ? 'paused' : 'running',
      score: done ? nonogramScore(size, seconds, wrong) : 0,
      elapsedMs: seconds * 1000,
      difficulty: 1,
      hud: [
        { label: 'Filled', value: `${marks.filter((m) => m === 1).length}/${inkCount(picture)}` },
        { label: 'Wrong', value: wrong },
        { label: 'Time', value: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }
      ]
    })

  const render = (): void => {
    for (let i = 0; i < cells.length; i++) {
      const classes = ['nono-cell']
      if (marks[i] === 1) classes.push('filled')
      if (marks[i] === 2) classes.push('crossed')
      if (i === focus) classes.push('focused')
      // A gap every five squares, the way a nonogram is printed, so the eye can count without counting.
      if ((i % size) % 5 === 4 && i % size !== size - 1) classes.push('edge-right')
      if (Math.floor(i / size) % 5 === 4 && Math.floor(i / size) !== size - 1) classes.push('edge-bottom')
      cells[i].className = classes.join(' ')
      cells[i].textContent = marks[i] === 2 ? '×' : ''
      cells[i].setAttribute('aria-label', `Row ${Math.floor(i / size) + 1} column ${(i % size) + 1}: ${marks[i] === 1 ? 'filled' : marks[i] === 2 ? 'crossed out' : 'empty'}`)
    }
    for (let r = 0; r < size; r++) rowClues[r].classList.toggle('solved', lineSolved(marks, rowIndexes(r), made.puzzle.rows[r]))
    for (let c = 0; c < size; c++) colClues[c].classList.toggle('solved', lineSolved(marks, colIndexes(c), made.puzzle.cols[c]))
    fillButton.classList.toggle('on', mode === 1)
    crossButton.classList.toggle('on', mode === 2)
    emit()
  }

  const keep = (): void => {
    if (!done) ctx.save?.({ width: size, height: size, picture, marks, seconds, wrong, difficulty } satisfies NonogramSave)
  }

  const finish = (): void => {
    done = true
    window.clearInterval(clock)
    ctx.save?.(null)
    ctx.audio.blip(740, 150, 'sine')
    ctx.audio.blip(1100, 250, 'sine')
    note.textContent = 'That is the picture.'
    render()
    ctx.over({ score: nonogramScore(size, seconds, wrong), extra: { difficulty } })
  }

  /** `want` is 1 to fill, 2 to cross out. Doing it again to the same square clears it. */
  const mark = (index: number, want: number): void => {
    if (paused || done || index < 0 || index >= marks.length) return
    focus = index
    const already = marks[index] === want
    if (already) {
      marks[index] = 0
      ctx.audio.blip(300, 20, 'triangle', 0.3)
      render()
      keep()
      return
    }
    if (want === 1 && !picture[index]) {
      wrong++
      marks[index] = strict ? 1 : 2
      note.textContent = strict ? 'That one is wrong, and it has been left where you put it.' : 'That square is empty, so it has been crossed out.'
      ctx.audio.blip(170, 140, 'sawtooth', 0.5)
      render()
      keep()
      return
    }
    marks[index] = want
    ctx.audio.blip(want === 1 ? 620 : 420, 20, 'square', 0.35)
    render()
    if (pictureDone(marks, picture)) finish()
    else keep()
  }

  const startClock = (): void => {
    window.clearInterval(clock)
    clock = window.setInterval(() => {
      if (paused || done) return
      seconds++
      emit()
      if (seconds % 10 === 0) keep()
    }, 1000)
  }

  const indexOf = (e: Event): number | null => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.nono-cell')
    return cell ? Number(cell.dataset.index) : null
  }

  const onDown = (e: PointerEvent): void => {
    const index = indexOf(e)
    if (index === null) return
    // A right-click arrives as a pointer press and a context menu both. The context menu does the marking, or the
    // square would be crossed out and then straight back in again.
    if (e.button === 2) {
      painting = 2
      return
    }
    painting = mode
    mark(index, mode)
  }
  // Dragging across a row does the same thing to each square it passes over, which is how a long run gets filled. It
  // only touches squares that are still empty, so a drag can never wipe out work already done.
  const onOver = (e: PointerEvent): void => {
    if (painting === null) return
    const index = indexOf(e)
    if (index === null || marks[index] !== 0) return
    mark(index, painting)
  }
  const onUp = (): void => {
    painting = null
  }
  const onContext = (e: MouseEvent): void => {
    const index = indexOf(e)
    if (index === null) return
    e.preventDefault()
    mark(index, 2)
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey || paused || done) return
    const by: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -size, ArrowDown: size }
    if (e.code in by) {
      const next = focus + by[e.code]
      const sameRow = Math.abs(by[e.code]) === 1 ? Math.floor(next / size) === Math.floor(focus / size) : true
      if (next >= 0 && next < marks.length && sameRow) focus = next
      render()
    } else if (e.code === 'Space' || e.code === 'Enter') mark(focus, 1)
    else if (e.code === 'KeyF') mark(focus, 2)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  board.addEventListener('pointerdown', onDown)
  board.addEventListener('pointerover', onOver)
  board.addEventListener('contextmenu', onContext)
  fillButton.addEventListener('click', () => {
    mode = 1
    note.textContent = 'Clicking fills a square in.'
    render()
  })
  crossButton.addEventListener('click', () => {
    mode = 2
    note.textContent = 'Clicking crosses a square out.'
    render()
  })
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
  ctx.root.addEventListener('keydown', onKey)

  const fresh = (): void => {
    made = generateNonogram(difficulty)
    picture = made.picture
    marks = Array(size * size).fill(0)
    focus = 0
    wrong = 0
    seconds = 0
    paused = false
    done = false
    painting = null
    mode = 1
    build()
    note.textContent = `${size} by ${size}. The numbers are the runs of filled squares, in order.`
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
      if (!isNonogramSave(saved) || saved.difficulty !== difficulty || saved.width !== size || saved.height !== size) return false
      // The clues are worked out again from the picture that was saved, so a saved game cannot come back disagreeing
      // with its own numbers.
      picture = saved.picture.slice()
      made = { puzzle: cluesOf(picture, size, size), picture, difficulty, nudges: 0 }
      marks = saved.marks.slice()
      seconds = Math.max(0, Math.round(saved.seconds) || 0)
      wrong = Math.max(0, Math.round(saved.wrong) || 0)
      focus = 0
      done = false
      build()
      note.textContent = 'Carrying on where you left off.'
      startClock()
      render()
      return true
    },
    destroy() {
      keep()
      window.clearInterval(clock)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      ctx.root.removeEventListener('keydown', onKey)
      root.remove()
    },
    resize() {
      // The board is sized by the stylesheet.
    }
  }
}

const nonogram: GameModule = { id: 'nonogram', surface: 'dom', create }
export default nonogram
