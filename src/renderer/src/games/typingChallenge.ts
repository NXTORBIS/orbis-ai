import type { GameContext, GameInstance, GameModule } from './engine'
import { gameRandom } from './seed'
import { typingStats } from '../../../shared/gameLogic'

/** Original practice passages, written for Orbis. */
const PASSAGES = [
  'The signal dropped, but the orb kept spinning. Somewhere past the clouds a server waited for the connection to return.',
  'A quiet night on the station: the lights hummed, the stars drifted, and every keystroke echoed down the long corridor.',
  'Good typing is calm typing. Keep your eyes on the words ahead, let your fingers find the keys, and breathe between lines.',
  'Pack light, check the map twice, and always leave a little room in your bag for something you did not expect to find.',
  'Seven small rovers crossed the red valley at dawn, each one counting stones and sending tiny reports back to base.',
  'When the page will not load, try again in a moment. Networks wander off sometimes, but they usually find their way home.',
  'Bright comets trace thin silver lines across the sky, and patient watchers write down every one they manage to see.',
  'Build the habit first and the speed follows. Ten accurate minutes each day beat one rushed hour at the end of the week.'
]

const DURATION = { easy: 60, normal: 45, hard: 30 } as const

/**
 * Typing Challenge: type the passage shown. Correct characters turn bright, mistakes turn red; the result is words per
 * minute (from correct characters only) and accuracy. The timer starts at the first key. Only the text box takes the
 * keys, so Orbis shortcuts with Ctrl, Alt or Meta keep working.
 */
function create(ctx: GameContext): GameInstance {
  const surface = ctx.root.querySelector('.game-surface')!
  const root = document.createElement('div')
  root.className = 'tc'
  const text = document.createElement('div')
  text.className = 'tc-text'
  text.setAttribute('aria-hidden', 'true')
  const input = document.createElement('textarea')
  input.className = 'tc-input'
  input.setAttribute('aria-label', 'Type the passage here')
  input.spellcheck = false
  input.autocapitalize = 'off'
  input.autocomplete = 'off'
  input.rows = 3
  root.append(text, input)
  surface.appendChild(root)

  const seconds = DURATION[ctx.prefs.difficulty]
  let target = ''
  let startedAt = 0
  let pausedElapsed = 0
  let clock = 0
  let paused = false
  let over = false
  let streak = 0
  let bestStreak = 0
  let lastLength = 0

  const elapsedMs = (): number => (startedAt ? (paused ? pausedElapsed : pausedElapsed + performance.now() - startedAt) : 0)
  const stats = () => typingStats(target, input.value, elapsedMs())

  const emit = (): void => {
    const s = stats()
    ctx.emit({ status: over ? 'over' : paused ? 'paused' : startedAt ? 'running' : 'ready', score: s.wpm, elapsedMs: Math.round(elapsedMs()), difficulty: 1, hud: [{ label: 'Accuracy', value: `${s.accuracy}%` }, { label: 'Time left', value: `${Math.max(0, Math.ceil(seconds - elapsedMs() / 1000))}s` }, { label: 'Streak', value: streak }] })
  }

  const render = (): void => {
    text.innerHTML = ''
    const typed = input.value
    for (let i = 0; i < target.length; i++) {
      const span = document.createElement('span')
      span.textContent = target[i]
      span.className = i < typed.length ? (typed[i] === target[i] ? 'ok' : 'bad') : i === typed.length ? 'cursor' : ''
      text.appendChild(span)
    }
    emit()
  }

  const finish = (): void => {
    if (over) return
    over = true
    window.clearInterval(clock)
    input.disabled = true
    const s = stats()
    render()
    ctx.audio.blip(900, 200, 'sine')
    ctx.over({ score: s.wpm, extra: { bestAccuracy: s.accuracy, bestStreak } })
  }

  const onInput = (): void => {
    if (over || paused) return
    if (!startedAt) {
      startedAt = performance.now()
      clock = window.setInterval(() => {
        if (elapsedMs() >= seconds * 1000) finish()
        else emit()
      }, 250)
    }
    const typed = input.value
    if (typed.length > target.length) input.value = typed.slice(0, target.length)
    if (input.value.length > lastLength) {
      const i = input.value.length - 1
      if (input.value[i] === target[i]) {
        streak++
        bestStreak = Math.max(bestStreak, streak)
      } else {
        streak = 0
        ctx.audio.blip(180, 40, 'square', 0.3)
      }
    }
    lastLength = input.value.length
    render()
    if (input.value.length >= target.length) finish()
  }
  // Game keys never leave the text box as game input; Orbis shortcuts (with modifiers) pass through untouched.
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey) return
    e.stopPropagation()
    if (e.key === 'Enter') e.preventDefault()
  }
  input.addEventListener('input', onInput)
  input.addEventListener('keydown', onKey)
  input.addEventListener('paste', (e) => e.preventDefault())

  const fresh = (): void => {
    window.clearInterval(clock)
    // The day's seed gives everyone on this machine the same passage all day; without one, any passage.
    target = PASSAGES[Math.floor(gameRandom(ctx)() * PASSAGES.length)]
    input.value = ''
    input.disabled = false
    startedAt = pausedElapsed = streak = bestStreak = lastLength = 0
    paused = over = false
    render()
    input.focus()
  }

  return {
    start: fresh,
    restart: fresh,
    pause() {
      if (over || paused) return
      pausedElapsed = elapsedMs()
      paused = true
      input.disabled = true
      emit()
    },
    resume() {
      if (!paused) return
      paused = false
      if (startedAt) startedAt = performance.now()
      input.disabled = false
      input.focus()
      emit()
    },
    destroy() {
      window.clearInterval(clock)
      root.remove()
    },
    resize() {
      // Fills its area with CSS.
    }
  }
}

const typingChallenge: GameModule = { id: 'typing-challenge', surface: 'dom', create }
export default typingChallenge
