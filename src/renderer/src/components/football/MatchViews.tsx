import { useEffect, useMemo, useState } from 'react'
import { arrangeLineup, replaySteps, type ReplayStep } from '../../../../shared/football/insights'
import type { FbLineupPlayer } from '../../../../shared/football/extras'
import type { FbMatch } from '../../../../shared/football/types'

/** True when the person (or the system) asked for less motion. */
export function useReducedMotion(preferred: boolean): boolean {
  const [sys, setSys] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false))
  useEffect(() => {
    if (!window.matchMedia) return
    const q = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = (): void => setSys(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return preferred || sys
}

// ---- the pitch --------------------------------------------------------------------------------------------------------------

/**
 * A football pitch in the proportions of a 105 × 68 m field: outline, halfway line, centre circle and spot, penalty
 * areas, goal areas, penalty spots and arcs, corner arcs. It is a drawing surface; anything placed on it says what it is.
 */
export function Pitch({ children, label }: { children?: React.ReactNode; label: string }): React.JSX.Element {
  // Units are metres. x runs 0..105 along the pitch, y 0..68 across.
  const line = { stroke: 'rgba(255,255,255,.55)', strokeWidth: 0.35, fill: 'none' }
  return (
    <svg className="fb-pitch" viewBox="-2 -2 109 72" role="img" aria-label={label}>
      <rect x={-2} y={-2} width={109} height={72} rx={2} fill="rgba(34,110,70,.35)" />
      <rect x={0} y={0} width={105} height={68} {...line} />
      <line x1={52.5} y1={0} x2={52.5} y2={68} {...line} />
      <circle cx={52.5} cy={34} r={9.15} {...line} />
      <circle cx={52.5} cy={34} r={0.5} fill="rgba(255,255,255,.7)" />
      {[0, 105].map((x) => {
        const dir = x === 0 ? 1 : -1
        return (
          <g key={x}>
            <rect x={x === 0 ? 0 : 105 - 16.5} y={13.84} width={16.5} height={40.32} {...line} />
            <rect x={x === 0 ? 0 : 105 - 5.5} y={24.84} width={5.5} height={18.32} {...line} />
            <circle cx={x + dir * 11} cy={34} r={0.5} fill="rgba(255,255,255,.7)" />
            <path d={`M ${x + dir * 16.5} ${34 - 7.3} A 9.15 9.15 0 0 ${x === 0 ? 1 : 0} ${x + dir * 16.5} ${34 + 7.3}`} {...line} />
            <rect x={x === 0 ? -1.2 : 105} y={30.34} width={1.2} height={7.32} {...line} />
          </g>
        )
      })}
      {[
        [0, 0, 1, 1],
        [0, 68, 1, -1],
        [105, 0, -1, 1],
        [105, 68, -1, -1]
      ].map(([cx, cy, sx, sy]) => (
        <path key={`${cx}-${cy}`} d={`M ${cx + sx} ${cy} A 1 1 0 0 ${sx * sy > 0 ? 1 : 0} ${cx} ${cy + sy}`} {...line} />
      ))}
      {children}
    </svg>
  )
}

/** The returned starters of both sides, arranged by position *name*; the note says so. */
export function LineupPitch({ players }: { players: FbLineupPlayer[] }): React.JSX.Element | null {
  const home = arrangeLineup(players, 'home')
  const away = arrangeLineup(players, 'away')
  if (home.placed.length + away.placed.length === 0) return null
  const dot = (p: { player: FbLineupPlayer; x: number; y: number }, colour: string, key: string): React.JSX.Element => (
    <g key={key} transform={`translate(${(p.x / 100) * 105},${(p.y / 100) * 68})`}>
      <title>{`${p.player.name}${p.player.position ? ` · ${p.player.position}` : ''}`}</title>
      <circle r={2.6} fill={colour} stroke="#fff" strokeWidth={0.35} />
      <text y={0.9} textAnchor="middle" fontSize={2.4} fill="#04101c" fontWeight={700}>
        {p.player.number ?? ''}
      </text>
      <text y={5.4} textAnchor="middle" fontSize={2.3} fill="#fff">
        {p.player.name.split(' ').slice(-1)[0]}
      </text>
    </g>
  )
  return (
    <>
      <Pitch label="Returned starting players, placed by position name">
        {home.placed.map((p, i) => dot(p, '#38e8ff', `h${i}`))}
        {away.placed.map((p, i) => dot(p, '#ffb03a', `a${i}`))}
      </Pitch>
      <p className="fb-note">
        Drawn from position names only (a goalkeeper at his own end, centre-backs across the middle…). It is an arrangement, not where anyone stood: the feed has no coordinates and no formation, and only the players it returned are shown.
      </p>
    </>
  )
}

// ---- when the goals came ----------------------------------------------------------------------------------------------------

/** Goals plotted by minute on a 0–90+ line, home above and away below. Goals with no minute are counted beside it, not drawn. */
export function EventStrip({ m }: { m: FbMatch }): React.JSX.Element | null {
  if (!m.eventsAvailable) return null
  const goals = m.events.filter((e) => !e.revoked)
  if (goals.length === 0) return null
  const placed = goals.filter((e) => e.minute !== null && e.side !== null)
  const loose = goals.length - placed.length
  const max = Math.max(95, ...placed.map((e) => e.minute as number))
  const X = (min: number): number => 6 + (min / max) * 188
  return (
    <figure>
      <svg viewBox="0 0 200 60" className="fb-strip" role="img" aria-label={`Goals by minute: ${placed.map((e) => `${e.minute}′ ${e.side}`).join(', ') || 'none placed'}`}>
        <line x1={6} x2={194} y1={30} y2={30} stroke="rgba(255,255,255,.35)" />
        {[0, 15, 30, 45, 60, 75, 90].map((t) => (
          <g key={t}>
            <line x1={X(t)} x2={X(t)} y1={28} y2={32} stroke="rgba(255,255,255,.5)" />
            <text x={X(t)} y={58} textAnchor="middle" fontSize={5} fill="rgba(255,255,255,.6)">
              {t}′
            </text>
          </g>
        ))}
        <line x1={X(45)} x2={X(45)} y1={8} y2={52} stroke="rgba(255,255,255,.15)" strokeDasharray="2 2" />
        {placed.map((e) => (
          <g key={e.id}>
            <title>{`${e.minute}′ ${e.player ?? ''}${e.kind === 'penalty-goal' ? ' (pen.)' : e.kind === 'own-goal' ? ' (own goal)' : ''}`}</title>
            <circle cx={X(e.minute as number)} cy={e.side === 'home' ? 18 : 42} r={3.2} fill={e.side === 'home' ? '#38e8ff' : '#ffb03a'} stroke="#fff" strokeWidth={0.4} />
          </g>
        ))}
      </svg>
      <figcaption className="fb-note">
        Home above the line, away below, by the minute the provider recorded.
        {loose > 0 ? ` ${loose} goal${loose === 1 ? '' : 's'} with no minute or side are not drawn.` : ''}
      </figcaption>
    </figure>
  )
}

// ---- replay -----------------------------------------------------------------------------------------------------------------

/** Steps through the recorded goals. It reviews the record; it is not a broadcast, and it never changes the real score. */
export function Replay({ m, reduceMotion }: { m: FbMatch; reduceMotion: boolean }): React.JSX.Element | null {
  const steps = useMemo<ReplayStep[]>(() => replaySteps(m), [m])
  const [i, setI] = useState(0)
  const [play, setPlay] = useState(false)
  useEffect(() => {
    setI(0)
    setPlay(false)
  }, [m.key])
  useEffect(() => {
    if (!play) return
    if (i >= steps.length - 1) {
      setPlay(false)
      return
    }
    const t = setTimeout(() => setI((x) => Math.min(steps.length - 1, x + 1)), reduceMotion ? 600 : 1400)
    return () => clearTimeout(t)
  }, [play, i, steps.length, reduceMotion])
  if (steps.length < 2) return null
  const s = steps[Math.min(i, steps.length - 1)]
  const live = m.status !== 'finished'
  return (
    <section className="fb-replay" aria-label="Replay of the recorded goals">
      <h4 className="fb-h">Replay of the goals</h4>
      <p className="fb-replay-score" aria-live="polite">
        {m.home.name} <b>{s.score.home} : {s.score.away}</b> {m.away.name}
      </p>
      <p className="fb-note">
        {s.label}
        {live ? ' · the match is not over: this replays what has been recorded so far' : ''}
      </p>
      <div className="fb-sourcebar">
        <button type="button" className="fb-btn" onClick={() => setI(0)} disabled={i === 0}>
          Start
        </button>
        <button type="button" className="fb-btn" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0}>
          Back
        </button>
        <button type="button" className="fb-btn" onClick={() => setPlay((p) => !p)} aria-pressed={play}>
          {play ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="fb-btn" onClick={() => setI((x) => Math.min(steps.length - 1, x + 1))} disabled={i >= steps.length - 1}>
          Next goal
        </button>
        <button type="button" className="fb-btn" onClick={() => setI(steps.length - 1)} disabled={i >= steps.length - 1}>
          Latest
        </button>
      </div>
    </section>
  )
}
