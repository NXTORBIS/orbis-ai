import type { GameContext, GameInstance, GameModule } from './engine'
import type { LightsSave } from '../../../shared/games/lightsOut'
import { allOff, generateRound, isLightsSave, pressAt, roundPlan, roundScore, solveLights } from '../../../shared/games/lightsOut'

/**
 * Lights Out: press a light and it flips, along with the four beside it. Turn them all off.
 *
 * Every board is made by pressing lights from a clear board, never by scattering them, because a scattered board
 * usually cannot be cleared at all and the player would have no way to tell that from being stuck. The board also
 * knows the fewest presses that clear it, which is what the score is measured against and where a hint comes from --
 * so a hint is the real answer, not a nudge in a likely direction.
 */
function create(ctx: GameContext): GameInstance {
  const surface = ctx.root.querySelector('.game-surface')!
  const root = document.createElement('div')
  root.className = 'lout'
  const board = document.createElement('div')
  board.className = 'lout-board'
  const bar = document.createElement('div')
  bar.className = 'lout-bar'
  const readout = document.createElement('span')
  readout.className = 'lout-readout'
  const hintButton = document.createElement('button')
  hintButton.type = 'button'
  hintButton.className = 'lout-hint'
  // Not in the tab order on purpose: the keys belong to the game while it has focus, and H does this.
  hintButton.tabIndex = -1
  hintButton.textContent = 'Hint (H)'
  bar.append(readout, hintButton)
  root.append(board, bar)
  surface.appendChild(root)

  const plan = roundPlan(ctx.prefs.difficulty)
  let index = 0
  let round = generateRound(plan[0].size, plan[0].scramble)
  let lights = [...round.lights]
  let presses = 0
  let hints = 0
  let score = 0
  let focus = 0
  let hinted: number | null = null
  let hintTimer = 0
  let paused = false
  let done = false
  /** Whether the run is under way, so a run picked up again can be paused before its first press. */
  let live = false
  let note = ''

  const size = (): number => round.size
  const cleared = (): boolean => allOff(lights)

  const emit = (): void =>
    ctx.emit({
      status: done ? 'over' : paused ? 'paused' : live || presses || index ? 'running' : 'ready',
      score,
      level: index + 1,
      elapsedMs: 0,
      difficulty: 1 + index * 0.4,
      hud: [
        { label: 'Board', value: `${index + 1} of ${plan.length}` },
        { label: 'Presses', value: presses },
        { label: 'Fewest', value: round.par },
        { label: 'On', value: lights.filter(Boolean).length }
      ]
    })

  const saveNow = (): void => {
    if (!done) ctx.save?.({ round: index, lights, size: round.size, par: round.par, presses, hints, score } satisfies LightsSave)
  }

  const render = (): void => {
    board.style.setProperty('--lout-size', String(size()))
    board.replaceChildren()
    lights.forEach((on, i) => {
      const cell = document.createElement('button')
      cell.type = 'button'
      cell.tabIndex = -1
      cell.className = `lout-cell${on ? ' on' : ''}${i === focus ? ' focused' : ''}${i === hinted ? ' hinted' : ''}`
      cell.dataset.index = String(i)
      cell.setAttribute('aria-label', `Row ${Math.floor(i / size()) + 1}, column ${(i % size()) + 1}: ${on ? 'on' : 'off'}`)
      board.appendChild(cell)
    })
    readout.textContent = note || (cleared() ? 'All off.' : `${lights.filter(Boolean).length} still on · ${presses} press${presses === 1 ? '' : 'es'} · ${round.par} would do it`)
    hintButton.disabled = done || paused || cleared()
    emit()
  }

  const nextRound = (): void => {
    const gained = roundScore(round.par, presses, hints)
    score += gained
    ctx.audio.blip(880, 200, 'sine')
    if (index + 1 >= plan.length) {
      done = true
      note = `All ${plan.length} boards cleared.`
      ctx.save?.(null)
      render()
      ctx.over({ score, extra: { difficulty: ctx.prefs.difficulty } })
      return
    }
    index++
    round = generateRound(plan[index].size, plan[index].scramble)
    lights = [...round.lights]
    presses = 0
    hints = 0
    hinted = null
    focus = 0
    note = `Board cleared: ${gained} points. The next one is ${round.size} by ${round.size}.`
    render()
    saveNow()
  }

  const press = (at: number): void => {
    if (paused || done || cleared()) return
    focus = at
    lights = pressAt(lights, size(), at)
    presses++
    live = true
    hinted = null
    note = ''
    ctx.audio.blip(lights[at] ? 660 : 440, 40, 'triangle', 0.45)
    if (cleared()) {
      render()
      nextRound()
      return
    }
    render()
    saveNow()
  }

  /** A hint is one light out of the real shortest answer, and it costs points. */
  const hint = (): void => {
    if (paused || done || cleared()) return
    const answer = solveLights(lights, size())
    if (!answer || !answer.length) {
      note = 'This board is already as good as clear.'
      render()
      return
    }
    hints++
    hinted = answer[Math.floor(Math.random() * answer.length)]
    note = `Press the marked light. ${answer.length} press${answer.length === 1 ? '' : 'es'} left from here.`
    ctx.audio.blip(300, 90, 'sine', 0.4)
    render()
    window.clearTimeout(hintTimer)
    hintTimer = window.setTimeout(() => {
      hinted = null
      render()
    }, 6000)
    saveNow()
  }

  const onClick = (e: MouseEvent): void => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.lout-cell')
    if (cell) return press(Number(cell.dataset.index))
    if ((e.target as HTMLElement).closest('.lout-hint')) hint()
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey) return
    const n = size()
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -n, ArrowDown: n }
    if (e.code in moves) {
      focus = Math.min(lights.length - 1, Math.max(0, focus + moves[e.code]))
      e.preventDefault()
      e.stopPropagation()
      render()
      return
    }
    if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault()
      e.stopPropagation()
      press(focus)
      return
    }
    if (e.code === 'KeyH') {
      e.preventDefault()
      e.stopPropagation()
      hint()
    }
  }

  root.addEventListener('click', onClick)
  ctx.root.addEventListener('keydown', onKey)

  const fresh = (): void => {
    index = 0
    round = generateRound(plan[0].size, plan[0].scramble)
    lights = [...round.lights]
    presses = 0
    hints = 0
    score = 0
    focus = 0
    hinted = null
    paused = false
    done = false
    live = false
    note = 'Press a light and the four beside it flip too.'
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
      saveNow()
      render()
    },
    resume() {
      if (!paused) return
      paused = false
      render()
    },
    restore(saved) {
      const s = saved as LightsSave
      if (!isLightsSave(s) || s.round >= plan.length) return false
      // A board that cannot be cleared is refused rather than handed to somebody as a puzzle.
      const answer = solveLights(s.lights, s.size)
      if (!answer) return false
      index = s.round
      round = { size: s.size, lights: s.lights, par: Number(s.par) || answer.length }
      lights = [...s.lights]
      presses = Math.max(0, Number(s.presses) || 0)
      hints = Math.max(0, Number(s.hints) || 0)
      score = Math.max(0, Number(s.score) || 0)
      focus = 0
      hinted = null
      live = true
      note = 'Picked up where you left off.'
      render()
      return true
    },
    destroy() {
      window.clearTimeout(hintTimer)
      saveNow()
      root.removeEventListener('click', onClick)
      ctx.root.removeEventListener('keydown', onKey)
      root.remove()
    },
    resize() {
      // The board is a CSS grid; it sizes itself.
    }
  }
}

const lightsOut: GameModule = { id: 'lights-out', surface: 'dom', create }
export default lightsOut
