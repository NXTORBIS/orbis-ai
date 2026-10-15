import { ArrowLeft, Check, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import './cosmos.css'

interface Props {
  onClose(): void
}

interface StageInfo {
  id: string
  label: string
  done: string
}

interface Snapshot {
  phase: 'idle' | 'starting' | 'ready' | 'failed'
  fraction: number
  current: string | null
  details: Record<string, string>
  why: string
  attention?: boolean
  stages: StageInfo[]
}

type CosmosEvent =
  | { kind: 'stage'; stage: string; detail: string | null; fraction: number; current: string | null }
  | { kind: 'attention' }
  | { kind: 'ready' }
  | { kind: 'failed'; why: string }

const FALLBACK_STAGES: StageInfo[] = []

export default function CosmosView({ onClose }: Props): React.JSX.Element {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const stage = useRef<HTMLDivElement>(null)
  const startedAt = useRef(Date.now())

  // On the first start the simulation sets up its data in its own window, so that window is shown.
  const waiting = snap?.attention === true && snap.phase === 'starting'

  const begin = useCallback(() => {
    startedAt.current = Date.now()
    setRevealed(false)
    setElapsed(0)
    window.api
      .cosmosStart()
      .then((s) => setSnap(s as Snapshot))
      .catch((e: unknown) => setSnap({ phase: 'failed', fraction: 0, current: null, details: {}, why: e instanceof Error ? e.message : String(e), stages: FALLBACK_STAGES }))
  }, [])

  useEffect(() => {
    begin()
    const off = window.api.onCosmosEvent((raw) => {
      const e = raw as CosmosEvent
      setSnap((prev) => {
        const base: Snapshot = prev ?? { phase: 'starting', fraction: 0, current: null, details: {}, why: '', stages: FALLBACK_STAGES }
        if (e.kind === 'stage') {
          return { ...base, fraction: e.fraction, current: e.current, details: e.detail ? { ...base.details, [e.stage]: e.detail } : base.details }
        }
        if (e.kind === 'attention') return { ...base, attention: true }
        if (e.kind === 'ready') return { ...base, phase: 'ready', fraction: 1, current: null }
        return { ...base, phase: 'failed', why: e.why }
      })
    })
    return () => {
      off()
      void window.api.cosmosStop()
      window.api.cosmosRegion({ x: 0, y: 0, width: 0, height: 0, dpr: 1, visible: false })
    }
  }, [begin])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (snap?.phase !== 'starting') return
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 500)
    return () => clearInterval(t)
  }, [snap?.phase])

  useEffect(() => {
    if (snap?.phase !== 'ready') return
    const t = setTimeout(() => setRevealed(true), 900)
    return () => clearTimeout(t)
  }, [snap?.phase])

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const send = (): void => {
      const r = el.getBoundingClientRect()
      window.api.cosmosRegion({ x: r.left, y: r.top, width: r.width, height: r.height, dpr: window.devicePixelRatio, visible: revealed || waiting, viewportWidth: window.innerWidth })
    }
    send()
    const ro = new ResizeObserver(send)
    ro.observe(el)
    window.addEventListener('resize', send)
    const t = setInterval(send, 400)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', send)
      clearInterval(t)
    }
  }, [revealed, waiting])

  const failed = snap?.phase === 'failed'
  const ready = snap?.phase === 'ready'

  return (
    <section className="cosmos-full" aria-label="ORBIS COSMOS">
      <header className="cosmos-bar">
        <button type="button" className="cosmos-back" onClick={onClose} title="Back to chat (Esc)" aria-label="Back to chat">
          <ArrowLeft size={16} />
        </button>
        <span className="cosmos-bar-title">ORBIS COSMOS</span>
        <span className="cosmos-bar-note">{ready ? 'Simulation running' : failed ? 'Could not start' : waiting ? 'First start: setting up the universe data (one time, about 150 MB)' : 'Starting'}</span>
      </header>
      <div className="cosmos-stage" ref={stage}>
        {!revealed && !waiting && (
          <div className={`cosmos-loading${ready ? ' is-leaving' : ''}`} role={failed ? 'alert' : 'status'}>
            <Sky failed={failed} />
            <div className="cosmos-center">
              <Ring fraction={snap?.fraction ?? 0} failed={failed} />
              <h1 className="cosmos-wordmark">ORBIS <span>COSMOS</span></h1>
              {failed ? (
                <>
                  <p className="cosmos-line cosmos-line-bad">The simulation could not start.</p>
                  <p className="cosmos-why">{snap?.why}</p>
                  <button type="button" className="cosmos-retry" onClick={begin}>
                    <RefreshCw size={15} /> Try again
                  </button>
                </>
              ) : (
                <>
                  <p className="cosmos-line">
                    {ready ? 'Simulation running' : (snap?.stages.find((s) => s.id === snap.current)?.label ?? 'Starting')}
                    {!ready && <span className="cosmos-dots" aria-hidden="true" />}
                  </p>
                  <p className="cosmos-count">
                    {Math.round((snap?.fraction ?? 0) * 100)}% · {elapsed}s
                  </p>
                </>
              )}
            </div>
            {snap && snap.stages.length > 0 && (
              <ol className="cosmos-steps" aria-label="Start-up steps">
                {snap.stages.map((s, i) => {
                  const doneCount = Math.round(snap.fraction * snap.stages.length)
                  const state = i < doneCount ? 'done' : i === doneCount && !failed && !ready ? 'now' : 'wait'
                  return (
                    <li key={s.id} className={`cosmos-step is-${state}`}>
                      <span className="cosmos-tick">{state === 'done' ? <Check size={12} /> : null}</span>
                      <span className="cosmos-step-text">
                        {state === 'done' ? s.done : s.label}
                        {snap.details[s.id] && state !== 'wait' && <small>{snap.details[s.id]}</small>}
                      </span>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/** The progress ring. It is drawn toward the real value and never past it. */
function Ring({ fraction, failed }: { fraction: number; failed: boolean }): React.JSX.Element {
  const R = 62
  const C = 2 * Math.PI * R
  return (
    <svg className={`cosmos-ring${failed ? ' is-bad' : ''}`} viewBox="0 0 160 160" width="160" height="160" aria-hidden="true">
      <defs>
        <linearGradient id="cosmos-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#38e8ff" />
          <stop offset="1" stopColor="#8a6bff" />
        </linearGradient>
      </defs>
      <circle cx="80" cy="80" r={R} className="cosmos-ring-track" />
      <circle cx="80" cy="80" r={R} className="cosmos-ring-fill" strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, Math.max(0, fraction)))} />
      <circle cx="80" cy="80" r="48" className="cosmos-ring-inner" />
    </svg>
  )
}

/** A drifting star field with a slowly turning spiral galaxy behind it. Decoration only: it carries no information. */
function Sky({ failed }: { failed: boolean }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useRef({ failed })
  live.current = { failed }

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0
    let h = 0
    const resize = (): void => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const stars = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), z: 0.2 + Math.random() * 0.8, t: Math.random() * 6.28 }))
    const arms = 4
    const dust = Array.from({ length: 1400 }, () => {
      const arm = Math.floor(Math.random() * arms)
      const r = Math.pow(Math.random(), 0.7)
      return { a: (arm / arms) * 6.283 + r * 5.2 + (Math.random() - 0.5) * 0.5, r, s: 0.4 + Math.random() * 1.1, hue: Math.random() }
    })
    let raf = 0
    let last = performance.now()
    let spin = 0
    const frame = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      spin += reduce ? 0 : dt * 0.06
      ctx.clearRect(0, 0, w, h)
      const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7)
      bg.addColorStop(0, '#0a1230')
      bg.addColorStop(0.55, '#050a1c')
      bg.addColorStop(1, '#02040c')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)

      const cx = w / 2
      const cy = h / 2
      const size = Math.min(w, h) * 0.62
      ctx.globalCompositeOperation = 'lighter'
      const tint = live.current.failed ? [255, 120, 120] : [110, 190, 255]
      for (const p of dust) {
        const a = p.a + spin * (1.2 - p.r * 0.8)
        const x = cx + Math.cos(a) * p.r * size
        const y = cy + Math.sin(a) * p.r * size * 0.42
        const k = 0.5 + 0.5 * p.hue
        ctx.fillStyle = `rgba(${Math.round(tint[0] * k + 70)},${Math.round(tint[1] * k + 40)},${tint[2]},${0.16 + (1 - p.r) * 0.35})`
        ctx.fillRect(x, y, p.s, p.s)
      }
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.22)
      core.addColorStop(0, 'rgba(255,236,200,.5)')
      core.addColorStop(1, 'rgba(255,236,200,0)')
      ctx.fillStyle = core
      ctx.fillRect(cx - size * 0.3, cy - size * 0.3, size * 0.6, size * 0.6)

      for (const s of stars) {
        s.x -= dt * 0.006 * s.z
        if (s.x < 0) s.x += 1
        s.t += dt * (1 + s.z)
        const tw = reduce ? 1 : 0.6 + 0.4 * Math.sin(s.t)
        ctx.fillStyle = `rgba(220,235,255,${0.25 + 0.55 * s.z * tw})`
        const r = 0.5 + s.z * 1.1
        ctx.fillRect(s.x * w, s.y * h, r, r)
      }
      ctx.globalCompositeOperation = 'source-over'
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return <canvas ref={ref} className="cosmos-sky" aria-hidden="true" />
}
