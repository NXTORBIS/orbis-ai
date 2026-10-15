import { ArrowLeft, ChevronRight, Flag, Trophy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FbAnswer, FbMatch } from '../../../../shared/football/types'
import type { F1Answer, F1Race, F1RaceResult } from '../../../../shared/f1/types'
import type { StreamEvent } from '../../../../shared/f1/live/stream-types'
import { placeCars } from '../../../../shared/f1/raceStrip'
import { peekArenaReturn, setArenaReturn, withTransition } from '../../lib/motion'
import Tonight from './Tonight'
import './arena.css'

interface Props {
  onClose(): void
  onOpen(id: 'football' | 'f1'): void
}

const two = (n: number): string => String(n).padStart(2, '0')

/** "2d 04:12:09", or "starts now" inside the last minute. */
function countdown(ms: number): string {
  if (ms <= 0) return 'under way or just finished'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${d > 0 ? `${d}d ` : ''}${two(h)}:${two(m)}:${two(s % 60)}`
}

/** Moves a card's light with the pointer, so the glow sits under the cursor. Nothing here changes any data. */
function useGlow(): { ref: React.RefObject<HTMLButtonElement | null>; onMove: (e: React.PointerEvent) => void; onLeave: () => void } {
  const ref = useRef<HTMLButtonElement | null>(null)
  return {
    ref,
    onMove: (e) => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width
      const y = (e.clientY - r.top) / r.height
      el.style.setProperty('--mx', `${Math.round(x * 100)}%`)
      el.style.setProperty('--my', `${Math.round(y * 100)}%`)
      el.style.setProperty('--tx', `${((x - 0.5) * 6).toFixed(2)}deg`)
      el.style.setProperty('--ty', `${((0.5 - y) * 6).toFixed(2)}deg`)
    },
    onLeave: () => {
      const el = ref.current
      if (!el) return
      el.style.removeProperty('--tx')
      el.style.removeProperty('--ty')
    }
  }
}

const PHASE_WORDS: Record<string, string> = {
  live: 'LIVE',
  'last-session': 'Last session, not live',
  waiting: 'Waiting for a session',
  stale: 'Live, but the feed has gone quiet',
  disconnected: 'Connection lost',
  replay: 'REPLAY',
  connecting: 'Connecting',
  loading: 'Loading',
  idle: 'Not connected'
}

/**
 * The race strip: the field along a track, the leader at the right, everyone else by their real gap behind. It is fed by
 * the same live-timing connection the Live screen uses (opened here, closed when the Arena is left), so cars move when
 * the feed says they moved. Between sessions it shows the last session's final order and says that it is not live.
 */
function RaceStrip(): React.JSX.Element {
  const [ev, setEv] = useState<StreamEvent | null>(null)
  useEffect(() => {
    const off = window.api.onF1Stream((raw) => setEv(raw as StreamEvent))
    void window.api.f1StreamLive()
    return () => {
      off()
      void window.api.f1StreamStop()
    }
  }, [])
  const status = ev?.status ?? null
  const drivers = ev?.snapshot?.drivers ?? []
  const { cars, scaleSeconds } = placeCars(drivers.map((d) => ({ number: d.number, code: d.code, colour: d.colour, position: d.position, gapToLeader: d.gapToLeader })))
  const live = status?.phase === 'live' || status?.phase === 'replay'
  return (
    <span className={`arena-strip${live ? ' is-live' : ''}`} aria-label="Race strip">
      <span className="arena-strip-head">
        <i className={`arena-dot${live ? ' is-on' : ''}`} aria-hidden="true" />
        {PHASE_WORDS[status?.phase ?? 'idle'] ?? 'Not connected'}
        {cars.length > 0 && <small> · scale {Math.round(scaleSeconds)} s</small>}
      </span>
      <span className="arena-track" role="img" aria-label={cars.length ? `Order: ${cars.slice(0, 5).map((c) => c.code).join(', ')}` : 'No timing yet'}>
        <i className="arena-track-line" />
        <i className="arena-flag" />
        {cars.length === 0 ? <i className="arena-scan" /> : null}
        {cars.map((c) => (
          <i
            key={c.number}
            className={`arena-car${c.lapped ? ' is-lapped' : ''}${c.position === 1 ? ' is-lead' : ''}`}
            style={{ left: `${c.x}%`, top: `${(((c.position ?? 1) - 1) % 4) * 15 + 20}px`, background: c.colour ? `#${c.colour}` : '#9aa4b2' }}
            title={`P${c.position} ${c.code}${c.lapped ? ' (a lap or more down)' : ''}`}
          >
            {(c.position ?? 99) <= 3 && <b>{c.code}</b>}
          </i>
        ))}
      </span>
    </span>
  )
}

/**
 * The Arena's front door. Every number on it is read from the same providers the two screens use (live matches, the next
 * Grand Prix session); when a provider cannot be reached the card says so instead of showing a figure.
 */
export default function ArenaView({ onClose, onOpen }: Props): React.JSX.Element {
  const [live, setLive] = useState<{ n: number; shown: FbMatch[] } | 'loading' | 'unavailable'>('loading')
  const [next, setNext] = useState<{ race: F1Race; session: string; at: number } | null | 'loading' | 'unavailable'>('loading')
  const [last, setLast] = useState<F1RaceResult | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const fb = useGlow()
  const f1 = useGlow()
  // Coming back from a screen opened here, its card carries the transition name so the screen folds into it.
  const back = peekArenaReturn()
  useEffect(() => {
    if (back) setArenaReturn(null)
  }, [back])
  const open = (el: HTMLElement | null, id: 'football' | 'f1'): void => {
    if (el) el.style.setProperty('view-transition-name', 'arena-open')
    withTransition(() => onOpen(id))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let alive = true
    const pull = (): void => {
      window.api
        .footballLive()
        .then((raw) => {
          if (!alive) return
          const a = raw as FbAnswer<FbMatch[]>
          if (!a.ok) return setLive('unavailable')
          const on = a.data.filter((m) => ['first-half', 'half-time', 'second-half', 'extra-time', 'penalties', 'in-play'].includes(m.status))
          setLive({ n: on.length, shown: on.filter((m) => m.liveBasis === 'reported').slice(0, 4) })
        })
        .catch(() => alive && setLive('unavailable'))
    }
    pull()
    const t = setInterval(pull, 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  useEffect(() => {
    let alive = true
    window.api
      .f1Schedule('current')
      .then((raw) => {
        if (!alive) return
        const a = raw as F1Answer<F1Race[]>
        if (!a.ok) return setNext('unavailable')
        const t = Date.now()
        let best: { race: F1Race; session: string; at: number } | null = null
        for (const race of a.data) {
          for (const s of [...race.sessions, { name: 'Race', startsAt: race.startsAt }]) {
            // A date with no time of day cannot be counted down to.
            if (!s.startsAt || s.startsAt.length <= 10) continue
            const at = Date.parse(s.startsAt)
            if (!Number.isNaN(at) && at > t - 2 * 3600_000 && (best === null || at < best.at)) best = { race, session: s.name, at }
          }
        }
        setNext(best)
      })
      .catch(() => alive && setNext('unavailable'))
    window.api
      .f1Results('current', 'last')
      .then((raw) => {
        const a = raw as F1Answer<F1RaceResult | null>
        if (alive && a.ok) setLast(a.data)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const winner = last?.rows.find((r) => r.position === 1)

  return (
    <section className="arena-full" aria-label="Orbis Arena">
      <div className="arena-sky" aria-hidden="true">
        <i className="arena-beam is-a" />
        <i className="arena-beam is-b" />
        <i className="arena-beam is-c" />
        <i className="arena-grid" />
        <i className="arena-glow" />
      </div>

      <header className="arena-top">
        <button type="button" className="arena-back" onClick={onClose} aria-label="Back to chat" title="Back to chat (Esc)">
          <ArrowLeft size={16} />
        </button>
        <span className="arena-kicker">ORBIS</span>
      </header>

      <div className="arena-hero">
        <h1 className="arena-title">
          <span>ARENA</span>
        </h1>
        <p className="arena-tag">Live sport, from open data, with every number saying where it came from.</p>
      </div>

      <div className="arena-cards">
        <button type="button" ref={fb.ref} onPointerMove={fb.onMove} onPointerLeave={fb.onLeave} className="arena-card is-football" style={back === 'football' ? { viewTransitionName: 'arena-open' } : undefined} onClick={() => open(fb.ref.current, 'football')}>
          <span className="arena-card-glow" aria-hidden="true" />
          <span className="arena-card-pitch" aria-hidden="true" />
          <span className="arena-card-head">
            <Trophy size={22} />
            <b>FOOTBALL</b>
            <ChevronRight size={18} className="arena-go" />
          </span>
          <span className="arena-stat">
            {live === 'loading' ? (
              <em>Checking what is on…</em>
            ) : live === 'unavailable' ? (
              <em>Live scores could not be reached just now.</em>
            ) : (
              <>
                <span className={`arena-dot${live.n > 0 ? ' is-on' : ''}`} aria-hidden="true" />
                <strong>{live.n}</strong> {live.n === 1 ? 'match' : 'matches'} under way
              </>
            )}
          </span>
          {typeof live === 'object' && live.shown.length > 0 && (
            <span className="arena-ticker">
              {live.shown.map((m) => (
                <span key={m.key} className="arena-chip">
                  {m.home.name} <b>{m.score.home ?? '–'}–{m.score.away ?? '–'}</b> {m.away.name}
                  {m.minute !== null ? <small> {m.minute}′</small> : null}
                </span>
              ))}
            </span>
          )}
          <span className="arena-foot">Scores · fixtures · tables · form · replay · alerts</span>
        </button>

        <button type="button" ref={f1.ref} onPointerMove={f1.onMove} onPointerLeave={f1.onLeave} className="arena-card is-f1" style={back === 'f1' ? { viewTransitionName: 'arena-open' } : undefined} onClick={() => open(f1.ref.current, 'f1')}>
          <span className="arena-card-glow" aria-hidden="true" />
          <span className="arena-card-lines" aria-hidden="true" />
          <span className="arena-card-head">
            <Flag size={22} />
            <b>FORMULA 1</b>
            <ChevronRight size={18} className="arena-go" />
          </span>
          <span className="arena-stat">
            {next === 'loading' ? (
              <em>Reading the calendar…</em>
            ) : next === 'unavailable' ? (
              <em>The calendar could not be reached just now.</em>
            ) : next === null ? (
              <em>No further session is scheduled this season.</em>
            ) : (
              <>
                <small>
                  Next: {next.race.name} · {next.session}
                </small>
                <strong className="arena-count">{countdown(next.at - now)}</strong>
              </>
            )}
          </span>
          {winner && (
            <span className="arena-ticker">
              <span className="arena-chip">
                Last: {last?.race.name} — <b>{winner.driver.name}</b> ({winner.constructor.name})
              </span>
            </span>
          )}
          <RaceStrip />
          <span className="arena-foot">Live timing · replay · telemetry · strategy · championship · history</span>
        </button>
      </div>

      <Tonight />

      <div className="arena-next">
        <h2>On the list</h2>
        <ul>
          {['Basketball', 'Cricket', 'Tennis', 'Rugby'].map((s) => (
            <li key={s} aria-disabled="true">
              <b>{s}</b>
              <small>Planned: no data source chosen yet</small>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
