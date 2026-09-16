import type { GameContext, GameInstance, GameModule } from './engine'

type Phase = 'intro' | 'waiting' | 'go' | 'result' | 'early' | 'done' | 'paused'

const ROUNDS = 5

/**
 * Reaction Test: wait for the panel to say GO, then react. Pressing early doesn't count and says so. Five rounds give
 * an average and a best; the score is the average in milliseconds (lower is better). Timing uses performance.now() at
 * the moment the GO frame is painted.
 */
function create(ctx: GameContext): GameInstance {
  const root = document.createElement('div')
  root.className = 'rt'
  root.tabIndex = -1
  ctx.root.querySelector('.game-surface')?.appendChild(root)

  let phase: Phase = 'intro'
  let resumeTo: Phase = 'intro'
  let timer = 0
  let goAt = 0
  let times: number[] = []
  let early = 0
  let lastResult = 0

  const average = (): number => (times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0)

  const emit = (): void =>
    ctx.emit({
      status: phase === 'done' ? 'over' : phase === 'paused' ? 'paused' : phase === 'intro' ? 'ready' : 'running',
      score: average(),
      elapsedMs: 0,
      difficulty: 1,
      hud: [
        { label: 'Round', value: `${Math.min(times.length + (phase === 'done' ? 0 : 1), ROUNDS)}/${ROUNDS}` },
        { label: 'Best', value: times.length ? `${Math.min(...times)} ms` : '—' },
        { label: 'Early', value: early }
      ]
    })

  const render = (): void => {
    const view: Record<Phase, { cls: string; title: string; sub: string }> = {
      intro: { cls: 'rt-intro', title: 'Reaction Test', sub: `Click, tap or press Space when the panel turns green. ${ROUNDS} rounds.` },
      waiting: { cls: 'rt-wait', title: 'Wait for it…', sub: "Don't press yet." },
      go: { cls: 'rt-go', title: 'GO!', sub: 'Press now' },
      result: { cls: 'rt-result', title: `${lastResult} ms`, sub: times.length < ROUNDS ? 'Press to start the next round.' : '' },
      early: { cls: 'rt-early', title: 'Too early', sub: "That one doesn't count. Press to try the round again." },
      done: { cls: 'rt-result', title: `Average ${average()} ms`, sub: `Best ${times.length ? Math.min(...times) : 0} ms · ${early} early press${early === 1 ? '' : 'es'}` },
      paused: { cls: 'rt-intro', title: 'Paused', sub: 'Resume to continue.' }
    }
    const v = view[phase]
    root.className = `rt ${v.cls}`
    root.innerHTML = ''
    const title = document.createElement('div')
    title.className = 'rt-title'
    title.textContent = v.title
    const sub = document.createElement('div')
    sub.className = 'rt-sub'
    sub.textContent = v.sub
    root.append(title, sub)
    root.setAttribute('aria-live', 'assertive')
    emit()
  }

  const arm = (): void => {
    phase = 'waiting'
    render()
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      phase = 'go'
      render()
      // The moment the green frame is on screen, not when the timer fired.
      requestAnimationFrame(() => (goAt = performance.now()))
      ctx.audio.blip(880, 80, 'square', 0.6)
    }, 1200 + Math.random() * 2800)
  }

  const press = (): void => {
    switch (phase) {
      case 'intro':
      case 'result':
      case 'early':
        return arm()
      case 'waiting':
        window.clearTimeout(timer)
        early++
        phase = 'early'
        ctx.audio.blip(160, 200, 'sawtooth', 0.6)
        return render()
      case 'go': {
        if (!goAt) return
        lastResult = Math.round(performance.now() - goAt)
        goAt = 0
        times.push(lastResult)
        if (times.length >= ROUNDS) {
          phase = 'done'
          render()
          ctx.over({ score: average(), extra: { averageMs: average(), attempts: times.length + early } })
        } else {
          phase = 'result'
          render()
        }
        return
      }
    }
  }

  const onPointer = (e: PointerEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    press()
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'Space' && e.code !== 'Enter') return
    if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return
    e.preventDefault()
    e.stopPropagation()
    press()
  }
  root.addEventListener('pointerdown', onPointer)
  ctx.root.addEventListener('keydown', onKey)

  return {
    start() {
      times = []
      early = 0
      phase = 'intro'
      render()
    },
    pause() {
      if (phase === 'done' || phase === 'paused') return
      window.clearTimeout(timer)
      // An interrupted wait or GO starts that round over.
      resumeTo = phase === 'waiting' || phase === 'go' ? 'result' : phase
      if (resumeTo === 'result' && !times.length) resumeTo = 'intro'
      phase = 'paused'
      render()
    },
    resume() {
      if (phase !== 'paused') return
      phase = resumeTo
      render()
    },
    restart() {
      window.clearTimeout(timer)
      times = []
      early = 0
      phase = 'intro'
      render()
    },
    destroy() {
      window.clearTimeout(timer)
      root.removeEventListener('pointerdown', onPointer)
      ctx.root.removeEventListener('keydown', onKey)
      root.remove()
    },
    resize() {
      // Fills its area with CSS.
    }
  }
}

const reactionTest: GameModule = { id: 'reaction-test', surface: 'dom', create }
export default reactionTest
