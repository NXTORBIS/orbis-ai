import type { GameContext, GameInstance, GameModule } from './engine'
import { deal, memoryScore } from '../../../shared/gameLogic'

const FACES = ['🪐', '☄️', '🌙', '⭐', '🛰️', '🚀', '🌌', '🔭', '👾', '🌠', '🧭', '💫']
const PAIRS = { easy: 6, normal: 8, hard: 12 } as const

interface Saved {
  deck: string[]
  matched: number[]
  moves: number
  seconds: number
}

/**
 * Memory Match: flip two cards at a time to find every pair. Keyboard play moves a focus ring with the arrows and flips
 * with Enter or Space. Progress can be saved and continued.
 */
function create(ctx: GameContext): GameInstance {
  const surface = ctx.root.querySelector('.game-surface')!
  const root = document.createElement('div')
  root.className = 'mm'
  surface.appendChild(root)

  const pairs = PAIRS[ctx.prefs.difficulty]
  let deck: string[] = []
  let matched = new Set<number>()
  let open: number[] = []
  let moves = 0
  let seconds = 0
  let focus = 0
  let clock = 0
  let flipBack = 0
  let paused = false
  let over = false
  let started = false

  const cols = (): number => (deck.length <= 12 ? 4 : deck.length <= 16 ? 4 : 6)

  const emit = (): void =>
    ctx.emit({ status: over ? 'over' : paused ? 'paused' : started ? 'running' : 'ready', score: over ? memoryScore(pairs, moves, seconds) : matched.size / 2, elapsedMs: seconds * 1000, difficulty: 1, hud: [{ label: 'Pairs', value: `${matched.size / 2}/${pairs}` }, { label: 'Moves', value: moves }, { label: 'Time', value: `${seconds}s` }] })

  const save = (): void => {
    if (!over && started) ctx.save?.({ deck, matched: [...matched], moves, seconds } satisfies Saved)
  }

  const render = (): void => {
    root.style.setProperty('--mm-cols', String(cols()))
    root.innerHTML = ''
    deck.forEach((face, i) => {
      const card = document.createElement('button')
      const shown = matched.has(i) || open.includes(i)
      card.className = `mm-card${shown ? ' shown' : ''}${matched.has(i) ? ' matched' : ''}${i === focus ? ' focused' : ''}`
      card.type = 'button'
      card.tabIndex = -1
      card.setAttribute('aria-label', shown ? `Card ${i + 1}: ${face}` : `Card ${i + 1}, face down`)
      card.textContent = shown ? face : ''
      card.addEventListener('click', () => flip(i))
      root.appendChild(card)
    })
    emit()
  }

  const tick = (): void => {
    if (paused || over || !started) return
    seconds++
    emit()
    if (seconds % 5 === 0) save()
  }

  const flip = (i: number): void => {
    if (paused || over || matched.has(i) || open.includes(i) || open.length >= 2) return
    if (!started) {
      started = true
      clock = window.setInterval(tick, 1000)
    }
    focus = i
    open.push(i)
    ctx.audio.blip(520, 40, 'triangle', 0.5)
    if (open.length === 2) {
      moves++
      const [a, b] = open
      if (deck[a] === deck[b]) {
        matched.add(a).add(b)
        open = []
        ctx.audio.blip(990, 90, 'sine')
        if (matched.size === deck.length) {
          over = true
          window.clearInterval(clock)
          render()
          ctx.over({ score: memoryScore(pairs, moves, seconds), extra: { attempts: moves } })
          return
        }
        save()
      } else {
        flipBack = window.setTimeout(() => {
          open = []
          render()
        }, ctx.prefs.reducedMotion ? 500 : 800)
      }
    }
    render()
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey) return
    const c = cols()
    const moveBy: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -c, ArrowDown: c }
    if (e.code in moveBy) {
      e.preventDefault()
      e.stopPropagation()
      focus = Math.min(deck.length - 1, Math.max(0, focus + moveBy[e.code]))
      render()
    } else if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault()
      e.stopPropagation()
      flip(focus)
    }
  }
  ctx.root.addEventListener('keydown', onKey)

  const fresh = (): void => {
    window.clearInterval(clock)
    window.clearTimeout(flipBack)
    deck = deal(FACES, pairs)
    matched = new Set()
    open = []
    moves = seconds = focus = 0
    paused = over = started = false
    render()
  }

  return {
    start: fresh,
    restart() {
      fresh()
      ctx.save?.(null)
    },
    pause() {
      if (over || paused) return
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
      if (!s || !Array.isArray(s.deck) || s.deck.length !== pairs * 2 || !Array.isArray(s.matched)) return false
      deck = s.deck.map(String)
      matched = new Set(s.matched.filter((i) => Number.isInteger(i) && i >= 0 && i < deck.length))
      moves = Number(s.moves) || 0
      seconds = Number(s.seconds) || 0
      started = true
      window.clearInterval(clock)
      clock = window.setInterval(tick, 1000)
      render()
      return true
    },
    destroy() {
      save()
      window.clearInterval(clock)
      window.clearTimeout(flipBack)
      ctx.root.removeEventListener('keydown', onKey)
      root.remove()
    },
    resize() {
      // CSS grid.
    }
  }
}

const memoryMatch: GameModule = { id: 'memory-match', surface: 'dom', create }
export default memoryMatch
