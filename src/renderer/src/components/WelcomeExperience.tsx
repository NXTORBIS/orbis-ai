import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import ring from '../assets/orbis-ring-glass.png'
import logo from '../assets/orbis-logo.png'
import { confirmPassword, judgePassword, PASSWORD_MAX } from '../../../shared/passwordStrength'
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
  /**
   * Saves the name and the account password, and marks setup complete; rejects when nothing was saved.
   *
   * Both together, because a half-created account -- named but unprotected, or protected but unnamed -- is a state
   * nothing else in Orbis knows how to be in.
   */
  onComplete(name: string, password: string): Promise<void>
  /**
   * This account has a password and it has not been given yet, so startup stops here until it is.
   *
   * Separate from `needsName`: one is an account being made, the other an account being opened, and they never both
   * apply.
   */
  needsUnlock: boolean
  /**
   * Why Orbis locked itself, when it did so while it was open, or null for an ordinary start.
   *
   * A lock screen that appears in the middle of somebody's work and says nothing about why reads as a fault. Saying
   * "because this computer locked" costs nothing -- it is a thing they already know -- and turns a surprise into an
   * explanation.
   */
  lockedReason?: string | null
  /** Gives the password to the account. Resolves with the reason when it was not accepted. */
  onUnlock(password: string): Promise<{ ok: true } | { ok: false; why: string; waitMs: number }>
  /** The exit transition has started; the main interface should begin appearing. */
  onEnter(): void
  /** The exit transition has finished and the welcome layer can be removed. */
  onFinished(): void
}

type Phase = 'intro' | 'name' | 'saving' | 'saveError' | 'unlock' | 'unlocking' | 'greet' | 'exit'

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
export default function WelcomeExperience({ ready, needsName, needsUnlock, lockedReason, loadError, effects, onRetryLoad, onComplete, onUnlock, onEnter, onFinished }: Props): React.JSX.Element {
  const reduced = !effects
  const [phase, setPhase] = useState<Phase>(loadError ? 'name' : 'intro')
  const [introDone, setIntroDone] = useState(false)
  /** Loading is taking long enough that saying so is useful. */
  const [slow, setSlow] = useState(false)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [shown, setShown] = useState(false)
  /**
   * Whether the password fields have been looked at.
   *
   * A field nobody has typed in yet is not a mistake, so nothing is said about it until they leave it or submit. This is
   * what stops "12 more characters" appearing under an empty box the moment the screen opens.
   */
  const [touched, setTouched] = useState({ password: false, again: false })
  const [savedName, setSavedName] = useState('')
  /** What the person is typing to get in, and what Orbis last said about it. */
  const [unlockWith, setUnlockWith] = useState('')
  const [unlockProblem, setUnlockProblem] = useState('')
  const submitting = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useParticles(canvasRef, reduced)
  useParallax(rootRef, reduced)

  /**
   * Why the lock screen is here, in a sentence.
   *
   * Only for a lock that happened while Orbis was open. An ordinary start needs no explanation, and offering one would
   * invite the question.
   */
  const lockedBecause = ((): string => {
    switch (lockedReason) {
      case 'systemLock':
        return 'Orbis locked because this computer locked.'
      case 'systemUnlock':
        return 'Orbis asks for your password whenever this computer is unlocked.'
      case 'resume':
        return 'Orbis locked while this computer was asleep.'
      case 'inactivity':
        return 'Orbis locked because nobody had used this computer for a while.'
      case 'blur':
        return 'Orbis locked when it stopped being the window in front.'
      case 'allWindowsClosed':
        return 'Orbis locked when its last window closed.'
      case 'manual':
        return 'Orbis is locked.'
      default:
        return ''
    }
  })()

  const formPhase = phase === 'name' || phase === 'saving'
  const unlockPhase = phase === 'unlock' || phase === 'unlocking'
  const title = useTyped(TITLE, (formPhase || unlockPhase) && !loadError, reduced ? 0 : TYPE_MS)
  const greeting = useTyped(`Welcome, ${savedName}.`, (phase === 'greet' || phase === 'exit') && Boolean(savedName), reduced ? 0 : GREET_TYPE_MS)

  const clean = cleanName(name)
  const nameValid = NAME_CHAR.test(clean)
  // Judged against the name as well: a password that is just the name protects nothing, and the name is on the screen
  // directly above the field.
  const strength = judgePassword(password, clean)
  const match = confirmPassword(password, again)
  const valid = nameValid && strength.ok && match.ok

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
    // Three ways past the intro: make an account, open one, or simply carry on into Orbis.
    if (needsName) {
      if (phase === 'intro' && introDone) setPhase('name')
    } else if (needsUnlock) {
      if (phase === 'intro' || phase === 'name') setPhase('unlock')
    } else if (phase === 'intro' || phase === 'name' || phase === 'unlock') {
      setPhase('exit')
    }
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
    if ((phase === 'name' || phase === 'unlock') && !loadError) inputRef.current?.focus()
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
    // Submitting is also "looking at" every field, so an incomplete form explains itself rather than doing nothing.
    setTouched({ password: true, again: true })
    if (submitting.current || !valid) return
    submitting.current = true
    setPhase('saving')
    try {
      await onComplete(clean, password)
      setSavedName(clean)
      // Forgotten the moment it has been used. It is not needed again, and what is not held cannot leak.
      setPassword('')
      setAgain('')
      setPhase('greet')
    } catch {
      submitting.current = false
      // The name and both passwords are left exactly as typed: a failure to save is not a reason to make somebody
      // choose a password again.
      setPhase('saveError')
    }
  }

  const tryUnlock = async (): Promise<void> => {
    if (phase === 'unlocking' || !unlockWith) return
    setPhase('unlocking')
    setUnlockProblem('')
    const said = await onUnlock(unlockWith)
    if (said.ok) {
      // Forgotten as soon as it has been used.
      setUnlockWith('')
      setPhase('exit')
      return
    }
    setUnlockProblem(said.why)
    setPhase('unlock')
    // What they typed is cleared, because it was wrong and the next attempt starts from nothing. The message stays.
    setUnlockWith('')
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

        {/*
          The password, on the same screen rather than a step after it.
          The fields appear once there is a name, so the screen opens as the one question it always was and grows into
          the second only when the first is answered.
        */}
        <div className={`welcome-secure${nameValid ? ' is-shown' : ''}`}>
          <label htmlFor="welcome-password" className="welcome-label">
            Create a password
          </label>
          <div className="welcome-field has-reveal">
            <input
              id="welcome-password"
              className="welcome-input"
              type={shown ? 'text' : 'password'}
              value={password}
              maxLength={PASSWORD_MAX}
              placeholder="A phrase you will remember"
              autoComplete="new-password"
              spellCheck={false}
              readOnly={phase === 'saving'}
              aria-describedby="welcome-password-note"
              aria-invalid={touched.password && !strength.ok}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            />
            <button
              type="button"
              className="welcome-reveal"
              // Labelled by what it will do, not by what is showing, so a screen reader is not told the password's state.
              aria-label={shown ? 'Hide password' : 'Show password'}
              title={shown ? 'Hide password' : 'Show password'}
              onClick={() => setShown((was) => !was)}
            >
              {shown ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {/*
            The meter draws the same judgement the main process will make, so the screen can never encourage a password
            that would then be refused. `aria-hidden` because the words underneath already say it.
          */}
          <div className="welcome-meter" aria-hidden="true" data-strength={password ? strength.strength : 'none'}>
            <span style={{ width: `${(strength.score / 4) * 100}%` }} />
          </div>
          <p id="welcome-password-note" className="welcome-note" role={strength.problem ? 'alert' : undefined}>
            {touched.password && strength.problem
              ? strength.problem
              : password && strength.ok
                ? `${strength.strength[0].toUpperCase()}${strength.strength.slice(1)}. ${strength.advice}`.trim()
                : 'At least 12 characters. A few ordinary words are stronger than one clever one.'}
          </p>

          <label htmlFor="welcome-again" className="welcome-label">
            Confirm password
          </label>
          <div className="welcome-field">
            <input
              id="welcome-again"
              className="welcome-input"
              type={shown ? 'text' : 'password'}
              value={again}
              maxLength={PASSWORD_MAX}
              placeholder="Type it once more"
              autoComplete="new-password"
              spellCheck={false}
              readOnly={phase === 'saving'}
              aria-describedby="welcome-again-note"
              aria-invalid={touched.again && Boolean(match.problem)}
              onChange={(e) => setAgain(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, again: true }))}
            />
          </div>
          <p id="welcome-again-note" className="welcome-note" role={match.problem ? 'alert' : undefined}>
            {/* The same rule: a confirmation only disagrees once it is as long as what it is confirming. */}
            {(touched.again || again.length >= password.length) && match.problem
              ? match.problem
              : again && match.ok
                ? 'They match.'
                : ' '}
          </p>

          <p className="welcome-note is-quiet">
            This password protects this profile on this computer. Orbis cannot recover it for you.
          </p>
        </div>

        <button type="submit" className="welcome-continue" disabled={!valid || phase === 'saving'}>
          {nameValid ? 'Create Account' : 'Continue'}
        </button>
        <p className={`welcome-hint${valid ? ' is-shown' : ''}`} aria-hidden="true">
          Press Enter to continue
        </p>
      </form>
    )
  } else if (unlockPhase) {
    /*
     * Opening an account.
     *
     * The same screen, the same field, the same ring behind it -- because this is still Orbis starting up, not a
     * security product interrupting it. It says whose account it is by name, which is not a secret: the name is what
     * the person chose to be called and appears throughout Orbis anyway.
     */
    stage = (
      <form
        className="welcome-panel"
        onSubmit={(e) => {
          e.preventDefault()
          void tryUnlock()
        }}
      >
        <h1 className="welcome-title" aria-label={TITLE}>
          <span aria-hidden="true">{title.text}</span>
          {!title.done && <span className="welcome-caret" aria-hidden="true" />}
        </h1>
        <label htmlFor="welcome-unlock" className={`welcome-sub${title.done ? ' is-shown' : ''}`}>
          Enter your password to continue
        </label>
        {lockedBecause && (
          <p className={`welcome-because${title.done ? ' is-shown' : ''}`} role="status">
            {lockedBecause}
          </p>
        )}
        <div className="welcome-field has-reveal">
          <input
            id="welcome-unlock"
            ref={inputRef}
            className="welcome-input"
            type={shown ? 'text' : 'password'}
            value={unlockWith}
            maxLength={PASSWORD_MAX}
            placeholder="Your password"
            autoComplete="current-password"
            spellCheck={false}
            readOnly={phase === 'unlocking'}
            aria-describedby="welcome-unlock-note"
            aria-invalid={Boolean(unlockProblem)}
            onChange={(e) => setUnlockWith(e.target.value)}
          />
          <button
            type="button"
            className="welcome-reveal"
            aria-label={shown ? 'Hide password' : 'Show password'}
            title={shown ? 'Hide password' : 'Show password'}
            onClick={() => setShown((was) => !was)}
          >
            {shown ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <p id="welcome-unlock-note" className="welcome-note" role={unlockProblem ? 'alert' : undefined}>
          {unlockProblem || '\u00a0'}
        </p>
        <button type="submit" className="welcome-continue" disabled={!unlockWith || phase === 'unlocking'}>
          {phase === 'unlocking' ? 'Checking…' : 'Unlock'}
        </button>
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
      aria-label={needsName ? 'Welcome to Orbis' : needsUnlock ? 'Unlock Orbis' : 'Starting Orbis'}
      aria-busy={!ready || phase === 'saving' || phase === 'unlocking'}
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
