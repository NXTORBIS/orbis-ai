import { useMemo, useState } from 'react'
import { neutralisations, positionByLap, type GapPoint } from '../../../../shared/f1/race'
import { formatLapTime } from '../../../../shared/f1/time'
import type { F1Answer, F1Session, F1SessionBundle, F1SessionTiming } from '../../../../shared/f1/types'
import { LineChart, type Series } from './Chart'
import { SessionPicker } from './SessionPicker'
import { ExportButton, Notes, SourceLine, Waiting, useF1 } from './shared'

const KIND_WORDS = { 'safety-car': 'Safety car', 'virtual-safety-car': 'Virtual safety car', 'red-flag': 'Red flag' } as const
const KIND_COLOUR = { 'safety-car': '#ffd34d', 'virtual-safety-car': '#ffa94d', 'red-flag': '#ff4d4d' } as const

export default function RacePanel({ year }: { year: number }): React.JSX.Element {
  const [session, setSession] = useState<F1Session | null>(null)
  const [timing, retryT] = useF1<F1SessionTiming>(session ? () => window.api.f1Timing(session.key, session.endsAt) as Promise<F1Answer<F1SessionTiming>> : null, [session?.key])
  const [bundle, retryB] = useF1<F1SessionBundle>(session ? () => window.api.f1Bundle(session.key, session.endsAt) as Promise<F1Answer<F1SessionBundle>> : null, [session?.key])
  const [gaps, setGaps] = useState<{ state: 'idle' | 'loading' | 'error' | 'ready'; data: GapPoint[]; message?: string }>({ state: 'idle', data: [] })
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [flagFilter, setFlagFilter] = useState('')

  const t = timing.state === 'ready' ? timing.answer.data : null
  const b = bundle.state === 'ready' ? bundle.answer.data : null

  const byLap = useMemo(() => (t && b ? positionByLap(b.positions, t.laps) : new Map<number, { lap: number; position: number }[]>()), [t, b])
  const periods = useMemo(() => (b ? neutralisations(b.raceControl) : []), [b])
  const code = (n: number): string => t?.drivers.find((d) => d.number === n)?.code ?? String(n)
  const colour = (n: number): string => `#${t?.drivers.find((d) => d.number === n)?.colour ?? '888888'}`

  // The first ten finishers by default: twenty lines on one chart say nothing.
  const defaults = useMemo(() => (b ? new Set(b.result.filter((r) => r.position !== null && r.position <= 10).map((r) => r.driverNumber)) : new Set<number>()), [b])
  const active = chosen.size > 0 ? chosen : defaults

  const posSeries: Series[] = [...byLap.entries()]
    .filter(([n]) => active.has(n))
    .map(([n, rows]) => ({ id: String(n), label: code(n), colour: colour(n), step: true, points: rows.map((r) => ({ x: r.lap, y: -r.position })) }))
  const bands = periods
    .filter((p) => p.startLap !== null)
    .map((p) => ({ from: p.startLap as number, to: p.endLap ?? (t ? Math.max(...t.laps.map((l) => l.lap)) : (p.startLap as number) + 1), colour: KIND_COLOUR[p.kind], label: `${KIND_WORDS[p.kind]}, lap ${p.startLap}${p.endLap ? ` to ${p.endLap}` : ' (end not reported)'}` }))

  const loadGaps = (): void => {
    if (!session) return
    setGaps({ state: 'loading', data: [] })
    void (window.api.f1Intervals(session.key, session.endsAt) as Promise<F1Answer<GapPoint[]>>).then((a) => setGaps(a.ok ? { state: 'ready', data: a.data } : { state: 'error', data: [], message: a.message }))
  }
  const sessionStart = session ? Date.parse(session.startsAt) : 0
  const gapSeries: Series[] = [...active].map((n) => ({
    id: String(n),
    label: code(n),
    colour: colour(n),
    points: gaps.data.filter((g) => g.driverNumber === n).map((g) => ({ x: (g.t - sessionStart) / 60000, y: g.gapToLeader }))
  }))

  const weather = b?.weather ?? []
  const weatherSeries: Series[] = [
    { id: 'air', label: 'Air °C', colour: '#4dc3ff', points: weather.map((w) => ({ x: (w.t - sessionStart) / 60000, y: w.airTemp })) },
    { id: 'track', label: 'Track °C', colour: '#ff8a4d', points: weather.map((w) => ({ x: (w.t - sessionStart) / 60000, y: w.trackTemp })) }
  ]
  const rainSpans = (() => {
    const out: { from: number; to: number; colour: string; label: string }[] = []
    let start: number | null = null
    for (const w of weather) {
      const m = (w.t - sessionStart) / 60000
      if (w.rainfall === true && start === null) start = m
      if (w.rainfall !== true && start !== null) {
        out.push({ from: start, to: m, colour: '#4d9bff', label: 'Rain reported' })
        start = null
      }
    }
    if (start !== null && weather.length) out.push({ from: start, to: (weather[weather.length - 1].t - sessionStart) / 60000, colour: '#4d9bff', label: 'Rain reported' })
    return out
  })()

  const made = new Map<number, number>()
  const suffered = new Map<number, number>()
  for (const o of b?.overtakes ?? []) {
    made.set(o.overtaking, (made.get(o.overtaking) ?? 0) + 1)
    suffered.set(o.overtaken, (suffered.get(o.overtaken) ?? 0) + 1)
  }
  const messages = (b?.raceControl ?? []).filter((m) => !flagFilter || (m.flag ?? '').toLowerCase() === flagFilter.toLowerCase() || m.category?.toLowerCase() === flagFilter.toLowerCase())
  const flags = Array.from(new Set((b?.raceControl ?? []).map((m) => m.flag).filter((f): f is string => !!f)))

  return (
    <>
      <div className="f1-controls">
        <SessionPicker year={year} value={session} onChange={(s) => { setSession(s); setChosen(new Set()); setGaps({ state: 'idle', data: [] }) }} only={['Race', 'Sprint']} />
      </div>
      {session && (timing.state !== 'ready' || bundle.state !== 'ready') && <Waiting load={timing.state !== 'ready' ? timing : bundle} retry={timing.state !== 'ready' ? retryT : retryB} what="the race record" />}
      {t && b && (
        <>
          <SourceLine load={bundle} retry={retryB} />
          {b.missing.length > 0 && <p className="f1-note f1-warn">The provider has no {b.missing.join(', ')} for this session, so those parts are left out.</p>}

          <div className="f1-controls">
            <h2 className="f1-h" style={{ margin: 0 }}>
              Classification
            </h2>
            <ExportButton
              name={`${session?.circuitName ?? 'session'}-${session?.name ?? ''}-classification`}
              header={['Position', 'Driver', 'Grid', 'Laps', 'Points', 'DNF', 'Overtakes made', 'Overtakes lost']}
              rows={b.result.map((r) => [r.position, code(r.driverNumber), b.grid.find((g) => g.driverNumber === r.driverNumber)?.position ?? null, r.laps, r.points, r.dnf, made.get(r.driverNumber) ?? 0, suffered.get(r.driverNumber) ?? 0])}
            />
          </div>
          <table className="f1-table">
            <thead>
              <tr>
                <th>Pos</th>
                <th>Driver</th>
                <th className="num">Grid</th>
                <th className="num">Laps</th>
                <th className="num">Time / gap</th>
                <th className="num">Pts</th>
                <th className="num">Overtakes</th>
              </tr>
            </thead>
            <tbody>
              {b.result.map((r) => (
                <tr key={r.driverNumber} className={chosen.has(r.driverNumber) ? 'is-on' : ''} onClick={() => setChosen((c) => { const n = new Set(c.size ? c : defaults); if (n.has(r.driverNumber)) n.delete(r.driverNumber); else n.add(r.driverNumber); return n })} tabIndex={0}>
                  <td>{r.dnf ? 'DNF' : r.dns ? 'DNS' : r.dsq ? 'DSQ' : (r.position ?? '–')}</td>
                  <td>
                    <span className="f1-swatch" style={{ background: colour(r.driverNumber) }} aria-hidden="true" />
                    {code(r.driverNumber)}
                  </td>
                  <td className="num">{b.grid.find((g) => g.driverNumber === r.driverNumber)?.position ?? '–'}</td>
                  <td className="num">{r.laps ?? '–'}</td>
                  <td className="num">
                    {typeof r.duration === 'number' ? (r.position === 1 ? formatLapTime(r.duration) : typeof r.gapToLeader === 'number' ? `+${r.gapToLeader.toFixed(3)}` : (r.gapToLeader ?? '–')) : '–'}
                  </td>
                  <td className="num">{r.points ?? '–'}</td>
                  <td className="num">
                    {made.get(r.driverNumber) ?? 0} made · {suffered.get(r.driverNumber) ?? 0} lost
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="f1-note">Click a driver to add or remove it from the charts below. Overtake counts are the provider&apos;s records of one car passing another on track.</p>

          <h2 className="f1-h">Position by lap</h2>
          {posSeries.length === 0 ? (
            <p className="f1-note">The provider has no position record for this session.</p>
          ) : (
            <>
              <LineChart series={posSeries} xLabel="Lap" yLabel="Position" yDomain={[-20.5, -0.5]} yFormat={(y) => String(Math.round(-y))} xFormat={(x) => `Lap ${Math.round(x)}`} bands={bands} height={260} description="Each selected driver's race position at the end of each lap" />
              {bands.length > 0 && (
                <p className="f1-legend">
                  {periods.map((p, i) => (
                    <span key={i}>
                      <i className="f1-dot" style={{ background: KIND_COLOUR[p.kind] }} /> {KIND_WORDS[p.kind]} from lap {p.startLap ?? '?'}
                      {p.endLap ? ` to ${p.endLap}` : ' (end not reported)'}
                    </span>
                  ))}
                </p>
              )}
            </>
          )}

          <h2 className="f1-h">Gap to the leader</h2>
          {gaps.state === 'idle' && (
            <button type="button" className="f1-btn" onClick={loadGaps}>
              Load gaps (a large download)
            </button>
          )}
          {gaps.state === 'loading' && <p className="f1-note">Loading gap readings…</p>}
          {gaps.state === 'error' && <p className="f1-note f1-bad">{gaps.message}</p>}
          {gaps.state === 'ready' && (
            <>
              <LineChart series={gapSeries} xLabel="Minutes into the session" yLabel="Seconds behind the leader" xFormat={(x) => `${Math.round(x)} min`} yFormat={(y) => `${Math.round(y)} s`} height={240} description="Selected drivers' gap to the leader through the session" />
              <p className="f1-note">Readings showing a lap deficit (&quot;1 LAP&quot;) have no time gap and are left out of the lines rather than drawn as a number.</p>
            </>
          )}

          {session && <Notes id={`race-${session.key}`} label="Notes on this session" />}
          <div className="f1-split">
            <div>
              <h2 className="f1-h">Weather</h2>
              {weather.length === 0 ? <p className="f1-note">No weather readings were recorded.</p> : <LineChart series={weatherSeries} xLabel="Minutes into the session" yLabel="°C" bands={rainSpans} xFormat={(x) => `${Math.round(x)} min`} height={170} description="Air and track temperature through the session, with rain periods shaded" />}
            </div>
            <div>
              <h2 className="f1-h">Race control</h2>
              <div className="f1-controls">
                <label>
                  Show
                  <select value={flagFilter} onChange={(e) => setFlagFilter(e.target.value)}>
                    <option value="">Everything</option>
                    {flags.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                    <option>SafetyCar</option>
                    <option>Drs</option>
                  </select>
                </label>
              </div>
              <ul className="f1-rc">
                {messages.length === 0 && <li className="f1-note">No messages.</li>}
                {messages.map((m, i) => (
                  <li key={i} className={m.flag ? `flag-${m.flag.toLowerCase().replace(/\s+/g, '-')}` : ''}>
                    <small>
                      {m.lap !== null ? `Lap ${m.lap}` : ''} {m.t ? new Date(m.t).toISOString().slice(11, 19) : ''}
                      {m.driverNumber !== null ? ` · ${code(m.driverNumber)}` : ''}
                    </small>
                    {m.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </>
  )
}
