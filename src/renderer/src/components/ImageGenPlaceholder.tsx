import { useEffect, useRef, useState } from 'react'
import { GAMES, drawDotGrid } from '../lib/imageGames'
import type { Game, GameId, GameKey, Palette, PointerKind } from '../lib/imageGames'

const PHRASES = ['Creating image', 'Sketching it out', 'Making the first draft', 'Adding the final details']

const KEYS: Record<string, GameKey> = {
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
  ' ': 'action', Enter: 'action'
}

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable; the game still works without it.
  }
}

function readPalette(el: HTMLElement): Palette {
  const style = getComputedStyle(el)
  const token = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback
  return {
    accent: token('--cyan', '#3fd8ff'),
    ink: token('--text', '#ededef'),
    muted: token('--faint', '#6e727b'),
    danger: token('--red', '#ff4d6d'),
    bg: token('--bg-mid', '#060708')
  }
}

/** Shown in place of the reply while an image renders; unmounts the moment the image arrives. */
export default function ImageGenPlaceholder(): React.JSX.Element {
  const [gameId, setGameId] = useState<GameId>(() => {
    const saved = stored('orbis.imageGame')
    return GAMES.find((g) => g.id === saved)?.id ?? 'snake'
  })
  const [phrase, setPhrase] = useState(0)
  const [score, setScore] = useState(0)
  const [best, setBest] = useState(0)
  const [hint, setHint] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<Game | null>(null)
  const focused = useRef(false)

  useEffect(() => {
    const timer = setInterval(() => setPhrase((p) => Math.min(p + 1, PHRASES.length - 1)), 3500)
    // Removing a focused node doesn't fire blur, so hand focus back to the composer explicitly.
    return () => {
      clearInterval(timer)
      if (focused.current) document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus()
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const root = rootRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !root || !ctx) return

    const game = (GAMES.find((g) => g.id === gameId) ?? GAMES[0]).create()
    gameRef.current = game
    store('orbis.imageGame', gameId)
    const bestKey = `orbis.imageGame.best.${gameId}`
    let bestScore = Number(stored(bestKey)) || 0
    setBest(bestScore)

    let palette = readPalette(root)
    let grid: HTMLCanvasElement | null = null
    let gridKey = ''
    let frame = 0
    let last = performance.now()
    let shownScore = -1
    let shownHint: string | null | undefined
    let raf = 0

    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      const px = Math.round(canvas.clientWidth * (window.devicePixelRatio || 1))
      if (!px) return
      if (canvas.width !== px) canvas.width = canvas.height = px
      if (++frame % 30 === 0) palette = readPalette(root)
      if (gridKey !== `${px}|${palette.muted}`) {
        grid = drawDotGrid(px, palette)
        gridKey = `${px}|${palette.muted}`
      }

      game.update(Math.min(0.05, (now - last) / 1000))
      last = now
      ctx.clearRect(0, 0, px, px)
      if (grid) ctx.drawImage(grid, 0, 0)
      game.draw(ctx, px, palette)

      // React state only changes when these do, so the loop doesn't re-render every frame.
      const s = game.score()
      if (s !== shownScore) {
        shownScore = s
        setScore(s)
        if (s > bestScore) {
          bestScore = s
          setBest(s)
          store(bestKey, String(s))
        }
      }
      const h = game.hint()
      if (h !== shownHint) {
        shownHint = h
        setHint(h)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [gameId])

  const onPointer =
    (kind: PointerKind) =>
    (e: React.PointerEvent<HTMLCanvasElement>): void => {
      const rect = e.currentTarget.getBoundingClientRect()
      if (kind === 'down') {
        rootRef.current?.focus({ preventScroll: true })
        e.currentTarget.setPointerCapture(e.pointerId)
      }
      gameRef.current?.pointer(kind, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
    }

  return (
    <div
      ref={rootRef}
      className="imagegen"
      tabIndex={0}
      role="application"
      aria-label="Mini game to play while the image is being created"
      onFocus={() => (focused.current = true)}
      onBlur={() => (focused.current = false)}
      onKeyDown={(e) => {
        const key = KEYS[e.key]
        if (!key || e.ctrlKey || e.metaKey || e.altKey) return
        e.preventDefault()
        gameRef.current?.key(key)
      }}
    >
      <div className="imagegen-head">
        <span key={phrase} className="imagegen-phrase">
          {PHRASES[phrase]}
        </span>
        <span className="imagegen-score">
          Score {score} · Best {best}
        </span>
      </div>
      <div className="imagegen-board">
        <canvas ref={canvasRef} onPointerDown={onPointer('down')} onPointerMove={onPointer('move')} onPointerUp={onPointer('up')} />
        {hint && <span className="imagegen-hint">{hint}</span>}
      </div>
      <div className="imagegen-tabs" role="tablist" aria-label="Choose a game">
        {GAMES.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={g.id === gameId}
            className={`imagegen-tab${g.id === gameId ? ' active' : ''}`}
            onClick={() => {
              setGameId(g.id)
              rootRef.current?.focus({ preventScroll: true })
            }}
          >
            {g.label}
          </button>
        ))}
      </div>
    </div>
  )
}
