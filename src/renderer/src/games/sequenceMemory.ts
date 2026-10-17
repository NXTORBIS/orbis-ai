import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import { checkPresses, growBy, growPattern, PANEL_COUNT, PANEL_NAMES, PANEL_TONES, playbackTiming, roundScore, SEQUENCE_LEVELS } from '../../../shared/games/sequence'

/**
 * Follow Along: four panels light in a pattern, you press them back in the same order, and the pattern gets one panel
 * longer every round. Each panel has its own tone, but the game never depends on hearing them — the panel lights, it
 * is numbered, and the line above the panels says whose turn it is, so it plays exactly the same with the sound off.
 *
 * On easy you can take as long as you like over each press and two mistakes are forgiven. On normal there is a clock
 * on each press and one mistake. On hard the clock is tighter, one mistake ends it, and from round six the pattern
 * grows by two at a time.
 */
function create(ctx: GameContext): GameInstance {
  const surface = ctx.root.querySelector('.game-surface')!
  const root = document.createElement('div')
  root.className = `fol${ctx.prefs.reducedMotion ? ' still' : ''}`
  const say = document.createElement('p')
  say.className = 'fol-say'
  say.setAttribute('role', 'status')
  say.setAttribute('aria-live', 'polite')
  const grid = document.createElement('div')
  grid.className = 'fol-grid'
  const panels: HTMLButtonElement[] = []
  for (let i = 0; i < PANEL_COUNT; i++) {
    const panel = document.createElement('button')
    panel.type = 'button'
    panel.className = `fol-panel fol-p${i}`
    panel.dataset.panel = String(i)
    panel.setAttribute('aria-label', `Panel ${i + 1}, ${PANEL_NAMES[i]}`)
    const label = document.createElement('span')
    label.textContent = String(i + 1)
    panel.appendChild(label)
    panels.push(panel)
    grid.appendChild(panel)
  }
  const hint = document.createElement('p')
  hint.className = 'fol-hint'
  hint.textContent = 'Click a panel or press 1 to 4. The keys and the panels do the same thing.'
  root.append(say, grid, hint)
  surface.appendChild(root)

  const level = SEQUENCE_LEVELS[ctx.prefs.difficulty]
  let status: GameStatus = 'ready'
  let pattern: number[] = []
  let pressed: number[] = []
  let round = 0
  let cleared = 0
  let points = 0
  let mistakesLeft = level.mistakes
  let turnStart = 0
  let startedAt = 0
  /** Which half of a round we are in: watching the pattern, or playing it back. */
  let phase: 'watch' | 'play' | null = null

  const timers = new Set<number>()
  const later = (ms: number, run: () => void): number => {
    const id = window.setTimeout(() => {
      timers.delete(id)
      run()
    }, ms)
    timers.add(id)
    return id
  }
  const stopTimers = (): void => {
    for (const id of timers) window.clearTimeout(id)
    timers.clear()
  }

  const emit = (): void =>
    ctx.emit({
      status,
      score: points,
      level: Math.max(1, round),
      elapsedMs: startedAt ? Math.round(performance.now() - startedAt) : 0,
      difficulty: Math.round((level.lit / playbackTiming(level, pattern.length || 1).lit) * 100) / 100,
      hud: [
        { label: 'Round', value: Math.max(1, round) },
        { label: 'Pattern', value: pattern.length },
        { label: 'Mistakes left', value: mistakesLeft }
      ]
    })

  const light = (panel: number, ms: number, tone = true): void => {
    const el = panels[panel]
    if (!el) return
    el.classList.add('lit')
    if (tone) ctx.audio.blip(PANEL_TONES[panel], Math.min(420, ms), 'sine', 0.9)
    later(ms, () => el.classList.remove('lit'))
  }
  const darkenAll = (): void => panels.forEach((p) => p.classList.remove('lit'))

  const playFrom = (index: number): void => {
    if (status !== 'running') return
    phase = 'watch'
    if (index >= pattern.length) {
      say.textContent = `Your turn — play back all ${pattern.length}.`
      root.classList.add('turn')
      pressed = []
      turnStart = performance.now()
      phase = 'play'
      startPressClock()
      emit()
      return
    }
    say.textContent = `Watch — ${index + 1} of ${pattern.length}`
    const timing = playbackTiming(level, pattern.length)
    light(pattern[index], timing.lit)
    later(timing.lit + timing.gap, () => playFrom(index + 1))
  }

  let pressClock = 0
  const startPressClock = (): void => {
    window.clearTimeout(pressClock)
    timers.delete(pressClock)
    if (!level.pressLimit || status !== 'running') return
    pressClock = later(level.pressLimit, () => {
      if (status === 'running' && phase === 'play') wrong('Too slow.')
    })
  }

  const finish = (): void => {
    status = 'over'
    stopTimers()
    darkenAll()
    root.classList.remove('turn')
    say.textContent = `The pattern was ${pattern.length} long. You cleared ${cleared} ${cleared === 1 ? 'round' : 'rounds'}.`
    ctx.audio.blip(160, 420, 'sawtooth')
    emit()
    ctx.over({ score: points, extra: { bestStreak: cleared, difficulty: ctx.prefs.difficulty } })
  }

  const wrong = (why: string): void => {
    stopTimers()
    darkenAll()
    ctx.audio.blip(130, 260, 'sawtooth')
    if (mistakesLeft <= 0) return finish()
    mistakesLeft--
    pressed = []
    root.classList.remove('turn')
    say.textContent = `${why} Watch it again.`
    emit()
    later(900, () => playFrom(0))
  }

  const nextRound = (): void => {
    round++
    pattern = growPattern(pattern, Math.random, round === 1 ? 1 : growBy(level, round))
    root.classList.remove('turn')
    say.textContent = `Round ${round}. Watch.`
    emit()
    later(600, () => playFrom(0))
  }

  const press = (panel: number): void => {
    if (status === 'ready') {
      status = 'running'
      startedAt = performance.now()
      light(panel, 180)
      nextRound()
      return
    }
    if (status !== 'running' || phase !== 'play') return
    light(panel, 200)
    pressed.push(panel)
    const verdict = checkPresses(pattern, pressed)
    if (verdict === 'wrong') return wrong('Not that one.')
    if (verdict === 'unfinished') {
      say.textContent = `Your turn — ${pressed.length} of ${pattern.length}`
      startPressClock()
      return
    }
    cleared++
    points += roundScore(round, ctx.prefs.difficulty, performance.now() - turnStart, pattern.length)
    phase = null
    window.clearTimeout(pressClock)
    root.classList.remove('turn')
    say.textContent = 'All of it. Next round.'
    ctx.audio.blip(880, 160, 'triangle', 0.8)
    emit()
    later(700, nextRound)
  }

  const onClick = (e: MouseEvent): void => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.fol-panel')
    if (el?.dataset.panel) press(Number(el.dataset.panel))
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey) return
    const digit = /^(Digit|Numpad)([1-4])$/.exec(e.code)
    if (digit) {
      e.preventDefault()
      e.stopPropagation()
      press(Number(digit[2]) - 1)
      return
    }
    if (e.code === 'Space' || e.code === 'Enter') {
      const focused = document.activeElement as HTMLElement | null
      const panel = focused?.closest<HTMLElement>('.fol-panel')?.dataset.panel
      e.preventDefault()
      e.stopPropagation()
      press(panel ? Number(panel) : 0)
    }
  }
  grid.addEventListener('click', onClick)
  ctx.root.addEventListener('keydown', onKey)

  const fresh = (): void => {
    stopTimers()
    darkenAll()
    status = 'ready'
    pattern = []
    pressed = []
    round = 0
    cleared = 0
    points = 0
    mistakesLeft = level.mistakes
    startedAt = 0
    phase = null
    root.classList.remove('turn')
    say.textContent = 'Press any panel to start. Watch the pattern, then play it back.'
    emit()
  }

  return {
    start: fresh,
    restart: fresh,
    pause() {
      if (status !== 'running') return
      status = 'paused'
      stopTimers()
      darkenAll()
      say.textContent = 'Paused.'
      emit()
    },
    resume() {
      if (status !== 'paused') return
      status = 'running'
      // Coming back mid-pattern is unfair either way, so the round starts again from the top.
      say.textContent = `Round ${round}. Watch.`
      pressed = []
      later(500, () => playFrom(0))
      emit()
    },
    destroy() {
      stopTimers()
      window.clearTimeout(pressClock)
      grid.removeEventListener('click', onClick)
      ctx.root.removeEventListener('keydown', onKey)
      root.remove()
    },
    resize() {
      // The panels are a CSS grid: they take the space they are given.
    }
  }
}

const sequenceMemory: GameModule = { id: 'sequence-memory', surface: 'dom', create }
export default sequenceMemory
