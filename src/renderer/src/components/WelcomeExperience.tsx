import { useEffect, useRef, useState } from 'react'
import ring from '../assets/orbis-ring-glass.png'
import logo from '../assets/orbis-logo.png'
import './welcome.css'

interface Props {
  /** Startup has finished loading local settings and chats, so what follows the intro is known. */
  ready: boolean
  /** No valid name is saved yet: the intro leads to the name step. Otherwise this is the normal startup screen. */
  needsName: boolean
  /** Local settings couldn't be read, so whether setup is finished is unknown. */
  loadError: boolean
  /**
   * Orbis's Visual effects setting (on until settings load). Motion follows it rather than the OS reduced-motion flag,
   * which Windows reports whenever its own animation effects are off.
   */
  effects: boolean
  onRetryLoad(): void
  /** Saves the name and marks setup complete; rejects when nothing was saved. */
  onComplete(name: string): Promise<void>
  /** The exit transition has started; the main interface should begin appearing. */
  onEnter(): void
  /** The exit transition has finished and the welcome layer can be removed. */
  onFinished(): void
}

type Phase = 'intro' | 'name' | 'saving' | 'saveError' | 'greet' | 'exit'

const TITLE = 'Welcome to Orbis'
const NAME_MAX = 40
const INTRO_MS = 3500
const TYPE_MS = 42
const GREET_TYPE_MS = 55
const GREET_HOLD_MS = 1100
const EXIT_MS = 900
/** A letter or digit in any script; spaces, hyphens and apostrophes around it are fine. */
const NAME_CHAR = /[\p{L}\p{N}]/u
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'])

function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX)
}

/** Reveals `text` one character at a time while `active`; stepMs 0 shows it at once. */
function useTyped(text: string, active: boolean, stepMs: number): { text: string; done: boolean } {
  const chars = Array.from(text)
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!active) {
      setCount(0)
      return
    }
    const total = Array.from(text).length
    if (stepMs === 0) {
      setCount(total)
      return
    }
    setCount(0)
    let shown = 0
    const timer = setInterval(() => {
      shown += 1
      setCount(shown)
      if (shown >= total) clearInterval(timer)
    }, stepMs)
    return () => clearInterval(timer)
  }, [text, active, stepMs])
  return { text: chars.slice(0, count).join(''), done: active && count >= chars.length }
}

/** A sparse field of slow light points on one canvas; drawn once and left still under reduced motion. */
function useParticles(canvasRef: React.RefObject<HTMLCanvasElement | null>, reduced: boolean): void {
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const start = performance.now()
    let width = 0
    let height = 0
    let frame = 0
    let last = start
    let points: { x: number; y: number; r: number; vx: number; vy: number; alpha: number; phase: number; born: number }[] = []

    const seed = (): void => {
      const count = Math.round(Math.min(64, Math.max(24, (width * height) / 36000)))
      points = Array.from({ length: count }, () => ({
        x: Math.random(),
        y: Math.random(),
        r: 0.4 + Math.random() * 1.1,
        vx: (Math.random() - 0.5) * 0.000006,
        vy: (Math.random() - 0.5) * 0.000006 - 0.000002,
        alpha: 0.12 + Math.random() * 0.5,
        phase: Math.random() * Math.PI * 2,
        born: 200 + Math.random() * 900
      }))
    }

    const draw = (now: number): void => {
      const t = now - start
      const dt = Math.min(now - last, 50)
      last = now
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#c4f1ff'
      for (const p of points) {
        if (!reduced) {
          p.x = (p.x + p.vx * dt + 1) % 1
          p.y = (p.y + p.vy * dt + 1) % 1
        }
        const fade = reduced ? 1 : Math.min(1, Math.max(0, (t - p.born) / 1000))
        const twinkle = reduced ? 1 : 0.75 + 0.25 * Math.sin(t / 1500 + p.phase)
        ctx.globalAlpha = p.alpha * fade * twinkle
        ctx.beginPath()
        ctx.arc(p.x * width, p.y * height, p.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const resize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (!points.length) seed()
      if (reduced) draw(performance.now())
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    const loop = (now: number): void => {
      draw(now)
      frame = requestAnimationFrame(loop)
    }
    if (!reduced) frame = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [canvasRef, reduced])
}

/** Feeds pointer position into CSS variables so layers can shift a few pixels apart. */
function useParallax(rootRef: React.RefObject<HTMLDivElement | null>, reduced: boolean): void {
  useEffect(() => {
    const root = rootRef.current
    if (!root || reduced) return
    let frame = 0
    let x = 0
    let y = 0
    const onMove = (e: PointerEvent): void => {
      x = e.clientX / window.innerWidth - 0.5
      y = e.clientY / window.innerHeight - 0.5
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        root.style.setProperty('--px', x.toFixed(3))
        root.style.setProperty('--py', y.toFixed(3))
      })
    }
    window.addEventListener('pointermove', onMove)
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(frame)
    }
  }, [rootRef, reduced])
}

/**
 * The Orbis startup screen. Every launch opens on it while local data loads; a new installation then asks for the
 * user's name, and a configured one hands over to the real interface as soon as it is ready.
 */
export default function WelcomeExperience({ ready, needsName, loadError, effects, onRetryLoad, onComplete, onEnter, onFinished }: Props): React.JSX.Element {
  const reduced = !effects
  const [phase, setPhase] = useState<Phase>(loadError ? 'name' : 'intro')
  const [introDone, setIntroDone] = useState(false)
  /** Loading is taking long enough that saying so is useful. */
  const [slow, setSlow] = useState(false)
  const [name, setName] = useState('')
  const [savedName, setSavedName] = useState('')
  const submitting = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useParticles(canvasRef, reduced)
  useParallax(rootRef, reduced)

  const formPhase = phase === 'name' || phase === 'saving'
  const title = useTyped(TITLE, formPhase && !loadError, reduced ? 0 : TYPE_MS)
  const greeting = useTyped(`Welcome, ${savedName}.`, (phase === 'greet' || phase === 'exit') && Boolean(savedName), reduced ? 0 : GREET_TYPE_MS)

  const clean = cleanName(name)
  const valid = NAME_CHAR.test(clean)

  // The intro plays once; any key or click cuts it short, and a typed character starts the name.
  useEffect(() => {
    if (phase !== 'intro' || introDone) return
    const skip = (e: Event): void => {
      if (e instanceof KeyboardEvent) {
        if (MODIFIER_KEYS.has(e.key)) return
        if (e.key.length === 1 && e.key.trim() && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault()
          setName(e.key)
        }
      }
      setIntroDone(true)
    }
    const timer = setTimeout(() => setIntroDone(true), reduced ? 400 : INTRO_MS)
    window.addEventListener('keydown', skip)
    window.addEventListener('pointerdown', skip)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', skip)
      window.removeEventListener('pointerdown', skip)
    }
  }, [phase, introDone, reduced])

  // What follows depends on real startup state, never on a timer: a saved name enters Orbis the moment loading is done,
  // even mid-intro; a missing name waits for the intro and then asks for it; a load failure shows its error at once.
  useEffect(() => {
    if (loadError) {
      if (phase === 'intro') setPhase('name')
      return
    }
    if (!ready) return
    if (!needsName && (phase === 'intro' || phase === 'name')) setPhase('exit')
    else if (needsName && phase === 'intro' && introDone) setPhase('name')
  }, [phase, ready, needsName, introDone, loadError])

  useEffect(() => {
    if (ready || loadError) {
      setSlow(false)
      return
    }
    const timer = setTimeout(() => setSlow(true), 1500)
    return () => clearTimeout(timer)
  }, [ready, loadError])

  // The field is ready for typing as soon as it appears, even while the heading is still typing.
  useEffect(() => {
    if (phase === 'name' && !loadError) inputRef.current?.focus()
  }, [phase, loadError])

  // After the personal greeting, hand over. Once it has fully appeared, a key press or click hands over straight away;
  // before that, extra presses (such as a double Enter on Continue) are ignored so the greeting is never lost.
  useEffect(() => {
    if (phase !== 'greet' || !greeting.done) return
    const skip = (e: Event): void => {
      if (e instanceof KeyboardEvent && (e.repeat || MODIFIER_KEYS.has(e.key))) return
      setPhase('exit')
    }
    const timer = setTimeout(() => setPhase('exit'), reduced ? 700 : GREET_HOLD_MS)
    const listen = setTimeout(() => {
      window.addEventListener('keydown', skip)
      window.addEventListener('pointerdown', skip)
    }, 300)
    return () => {
      clearTimeout(timer)
      clearTimeout(listen)
      window.removeEventListener('keydown', skip)
      window.removeEventListener('pointerdown', skip)
    }
  }, [phase, greeting.done, reduced])

  useEffect(() => {
    if (phase !== 'exit') return
    onEnter()
    const timer = setTimeout(onFinished, reduced ? 250 : EXIT_MS)
    return () => clearTimeout(timer)
  }, [phase, reduced, onEnter, onFinished])

  const submit = async (): Promise<void> => {
    if (submitting.current || !valid) return
    submitting.current = true
    setPhase('saving')
    try {
      await onComplete(clean)
      setSavedName(clean)
      setPhase('greet')
    } catch {
      submitting.current = false
      setPhase('saveError')
    }
  }

  let stage: React.JSX.Element | null = null
  if (loadError && phase !== 'exit') {
    stage = (
      <div className="welcome-panel" role="alert">
        <h1 className="welcome-title is-small">Orbis couldn&apos;t read its local setup.</h1>
        <p className="welcome-sub is-shown">Setup is stored on this computer. Try again, or continue into Orbis without it for now.</p>
        <button type="button" className="welcome-continue" autoFocus onClick={onRetryLoad}>
          Retry
        </button>
        <button type="button" className="welcome-secondary" onClick={() => setPhase('exit')}>
          Continue to Orbis
        </button>
      </div>
    )
  } else if (phase === 'saveError') {
    stage = (
      <div className="welcome-panel" role="alert">
        <h1 className="welcome-title is-small">Orbis couldn&apos;t save your name.</h1>
        <p className="welcome-sub is-shown">Nothing was changed. Try again, or continue now and Orbis will ask again next time it starts.</p>
        <button type="button" className="welcome-continue" autoFocus onClick={() => void submit()}>
          Retry
        </button>
        <button type="button" className="welcome-secondary" onClick={() => setPhase('exit')}>
          Continue without saving
        </button>
      </div>
    )
  } else if (formPhase) {
    stage = (
      <form
        className="welcome-panel"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h1 className="welcome-title" aria-label={TITLE}>
          <span aria-hidden="true">{title.text}</span>
          {!title.done && <span className="welcome-caret" aria-hidden="true" />}
        </h1>
        <label htmlFor="welcome-name" className={`welcome-sub${title.done ? ' is-shown' : ''}`}>
          What should I call you?
        </label>
        <div className="welcome-field">
          <input
            id="welcome-name"
            ref={inputRef}
            className="welcome-input"
            value={name}
            maxLength={NAME_MAX}
            placeholder="Enter your name"
            autoComplete="off"
            spellCheck={false}
            readOnly={phase === 'saving'}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button type="submit" className="welcome-continue" disabled={!valid || phase === 'saving'}>
          Continue
        </button>
        <p className={`welcome-hint${valid ? ' is-shown' : ''}`} aria-hidden="true">
          Press Enter to continue
        </p>
      </form>
    )
  } else if ((phase === 'greet' || phase === 'exit') && savedName) {
    stage = (
      <div className="welcome-panel" aria-live="polite">
        <h1 className="welcome-title" aria-label={`Welcome, ${savedName}.`}>
          <span aria-hidden="true">{greeting.text}</span>
          {!greeting.done && <span className="welcome-caret" aria-hidden="true" />}
        </h1>
        <p className={`welcome-sub${greeting.done ? ' is-shown' : ''}`}>Your Orbis is ready.</p>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className={`welcome is-${phase}${phase === 'exit' && !introDone ? ' is-early' : ''}${reduced ? ' reduced' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={needsName ? 'Welcome to Orbis' : 'Starting Orbis'}
      aria-busy={!ready || phase === 'saving'}
    >
      <div className="welcome-ambient" aria-hidden="true" />
      <canvas ref={canvasRef} className="welcome-particles" aria-hidden="true" />
      <div className="welcome-horizon" aria-hidden="true" />

      <div className="welcome-center">
        <div className="welcome-identity" aria-hidden="true">
          <div className="welcome-core">
            <svg className="welcome-orbits" viewBox="0 0 400 200">
              <g className="orbit-group sway-a">
                <ellipse className="orbit orbit-1" cx="200" cy="100" rx="196" ry="72" pathLength={1} />
                <circle className="orbit-node" r="1.8">
                  {!reduced && <animateMotion dur="18s" repeatCount="indefinite" path="M4,100 a196,72 0 1,0 392,0 a196,72 0 1,0 -392,0" />}
                </circle>
              </g>
              <g className="orbit-group sway-b">
                <ellipse className="orbit orbit-2" cx="200" cy="100" rx="168" ry="50" pathLength={1} />
              </g>
              <g className="orbit-group spin">
                <circle className="orbit orbit-3" cx="200" cy="100" r="62" pathLength={1} />
                <circle className="orbit-node node-small" cx="200" cy="38" r="1.3" />
              </g>
            </svg>
            <span className="welcome-pulse" />
            <img className="welcome-ring" src={ring} alt="" draggable={false} />
            <img className="welcome-wordmark" src={logo} alt="" draggable={false} />
          </div>
        </div>

        <div className="welcome-stage">{stage}</div>
      </div>

      {phase === 'intro' && slow && (
        <p className="welcome-skip welcome-status" role="status">
          Loading your settings and chats…
        </p>
      )}
      {phase === 'intro' && !slow && ready && needsName && !introDone && <p className="welcome-skip">Press any key to skip</p>}
    </div>
  )
}
