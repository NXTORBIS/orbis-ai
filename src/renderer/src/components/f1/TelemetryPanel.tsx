import { useEffect, useMemo, useState } from 'react'
import { lapStats, sessionBest } from '../../../../shared/f1/normalize'
import { buildLapTrace, compatibility, deltaTrace, summarize, type LapTrace } from '../../../../shared/f1/telemetry'
import type { LocationSample } from '../../../../shared/f1/telemetryData'
import type { CarSample } from '../../../../shared/f1/telemetry'
import { compareTimes, formatLapTime } from '../../../../shared/f1/time'
import type { F1Answer, F1Lap, F1Session, F1SessionTiming } from '../../../../shared/f1/types'
import { LineChart, TrackMap, type Series } from './Chart'
import { SessionPicker } from './SessionPicker'
import { Notes, SourceLine, Waiting, useF1, useSavedComparisons } from './shared'

type Axis = 'distance' | 'time'
const A_COLOUR = '#38e8ff'
const B_COLOUR = '#ffb03a'

interface Selection {
  driver: number | null
  lap: number | null
}

function lapWindow(l: F1Lap | undefined): { from: string; to: string; startMs: number; endMs: number } | null {
  if (!l || !l.startedAt || l.duration === null) return null
  const startMs = Date.parse(l.startedAt)
  if (!Number.isFinite(startMs)) return null
  const endMs = startMs + l.duration * 1000
  // A little either side: readings arrive about 3.7 times a second.
  return { from: new Date(startMs - 300).toISOString(), to: new Date(endMs + 300).toISOString(), startMs, endMs }
}

function useTelemetry(session: F1Session | null, sel: Selection, laps: F1Lap[]): { trace: LapTrace | null; location: LocationSample[]; load: ReturnType<typeof useF1<{ car: CarSample[]; location: LocationSample[] }>>[0]; retry: () => void; lap: F1Lap | undefined } {
  const lap = laps.find((l) => l.driverNumber === sel.driver && l.lap === sel.lap)
  const win = lapWindow(lap)
  const [load, retry] = useF1<{ car: CarSample[]; location: LocationSample[] }>(
    session && sel.driver !== null && win ? () => window.api.f1Telemetry(session.key, sel.driver as number, win.from, win.to) as Promise<F1Answer<{ car: CarSample[]; location: LocationSample[] }>> : null,
    [session?.key, sel.driver, sel.lap]
  )
  const trace = useMemo(() => (load.state === 'ready' && win ? buildLapTrace(load.answer.data.car, win.startMs, win.endMs) : null), [load, win?.startMs, win?.endMs])
  const location = load.state === 'ready' && win ? load.answer.data.location.filter((p) => p.t >= win.startMs && p.t <= win.endMs) : []
  return { trace, location, load, retry, lap }
}

export default function TelemetryPanel({ year }: { year: number }): React.JSX.Element {
  const [session, setSession] = useState<F1Session | null>(null)
  const [timing, retryTiming] = useF1<F1SessionTiming>(session ? () => window.api.f1Timing(session.key, session.endsAt) as Promise<F1Answer<F1SessionTiming>> : null, [session?.key])
  const [a, setA] = useState<Selection>({ driver: null, lap: null })
  const [b, setB] = useState<Selection>({ driver: null, lap: null })
  const [axis, setAxis] = useState<Axis>('distance')
  const [cursor, setCursor] = useState<number | null>(null)
  const saved = useSavedComparisons()
  const [pendingLoad, setPendingLoad] = useState<{ a: Selection; b: Selection } | null>(null)

  const data = timing.state === 'ready' ? timing.answer.data : null

  // Start from the session's fastest lap: the most informative one to look at first.
  useEffect(() => {
    if (!data) return
    setCursor(null)
    if (pendingLoad) {
      setA(pendingLoad.a)
      setB(pendingLoad.b)
      setPendingLoad(null)
      return
    }
    const best = sessionBest(data.laps)
    setA(best ? { driver: best.driverNumber, lap: best.lap } : { driver: null, lap: null })
    setB({ driver: null, lap: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const driverBest = (n: number | null): number | null => (data && n !== null ? (lapStats(data.laps, n).best?.lap ?? null) : null)
  const lapsOf = (n: number | null): F1Lap[] => (data && n !== null ? data.laps.filter((l) => l.driverNumber === n && l.duration !== null) : [])

  const ta = useTelemetry(session, a, data?.laps ?? [])
  const tb = useTelemetry(session, b, data?.laps ?? [])

  const colourOf = (n: number | null): string => data?.drivers.find((d) => d.number === n)?.colour ?? '888888'

  const xOf = (p: { distance: number; time: number }): number => (axis === 'distance' ? p.distance : p.time)
  const mk = (pick: (p: LapTrace['points'][number]) => number | null, step = false): Series[] => {
    const out: Series[] = []
    if (ta.trace) out.push({ id: 'a', label: `Lap ${a.lap}`, colour: A_COLOUR, step, points: ta.trace.points.map((p) => ({ x: xOf(p), y: pick(p) })) })
    if (tb.trace) out.push({ id: 'b', label: `Lap ${b.lap}`, colour: B_COLOUR, step, points: tb.trace.points.map((p) => ({ x: xOf(p), y: pick(p) })) })
    return out
  }

  const delta = ta.trace && tb.trace ? deltaTrace(ta.trace, tb.trace) : null
  const deltaSeries: Series[] = delta
    ? [
        {
          id: 'd',
          label: 'Lap B vs lap A',
          colour: '#ff6b9a',
          points: delta.map((p) => ({ x: axis === 'distance' ? p.distance : p.fraction * (ta.trace?.duration ?? 0), y: p.delta }))
        }
      ]
    : []

  const xFormat = axis === 'distance' ? (x: number) => `${Math.round(x)} m` : (x: number) => `${x.toFixed(1)} s`

  // The marker on the map: the position reading nearest in time to the cursor on lap A.
  const marker = useMemo(() => {
    if (cursor === null || !ta.trace || ta.location.length === 0) return null
    const pt = ta.trace.points.reduce((best, p) => (Math.abs(xOf(p) - cursor) < Math.abs(xOf(best) - cursor) ? p : best), ta.trace.points[0])
    const loc = ta.location.reduce((best, l) => (Math.abs(l.t - pt.t) < Math.abs(best.t - pt.t) ? l : best), ta.location[0])
    return { x: loc.x, y: loc.y }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, ta.trace, ta.location, axis])

  const trail = useMemo(() => {
    if (!ta.trace || ta.location.length < 10) return undefined
    const pts = ta.trace.points
    const maxV = Math.max(...pts.map((p) => p.speed ?? 0)) || 1
    return ta.location.map((l) => {
      const near = pts.reduce((best, p) => (Math.abs(p.t - l.t) < Math.abs(best.t - l.t) ? p : best), pts[0])
      return { x: l.x, y: l.y, v: (near.speed ?? 0) / maxV }
    })
  }, [ta.trace, ta.location])

  const sa = ta.trace ? summarize(ta.trace) : null
  const sb = tb.trace ? summarize(tb.trace) : null
  const why =
    ta.lap && tb.lap && session
      ? compatibility({ session: session.key, driver: ta.lap.driverNumber, lap: ta.lap.lap, pitOut: ta.lap.isPitOut }, { session: session.key, pitOut: tb.lap.isPitOut })
      : []

  const pct = (v: number | null): string => (v === null ? '–' : `${Math.round(v * 100)}%`)

  return (
    <>
      <div className="f1-controls">
        <SessionPicker year={year} value={session} onChange={setSession} />
      </div>
      {session && timing.state !== 'ready' && <Waiting load={timing} retry={retryTiming} what="the laps" />}
      {data && (
        <>
          <SourceLine load={timing} retry={retryTiming} />
          <div className="f1-lapsel">
            <fieldset>
              <legend style={{ color: A_COLOUR }}>Lap A</legend>
              <select aria-label="Driver for lap A" value={a.driver ?? ''} onChange={(e) => setA({ driver: Number(e.target.value), lap: driverBest(Number(e.target.value)) })}>
                {data.drivers.map((d) => (
                  <option key={d.number} value={d.number}>
                    {d.code} #{d.number}
                  </option>
                ))}
              </select>
              <select aria-label="Lap A" value={a.lap ?? ''} onChange={(e) => setA({ ...a, lap: Number(e.target.value) })}>
                {lapsOf(a.driver)
                  .slice()
                  .sort((x, y) => compareTimes(x.duration, y.duration))
                  .map((l) => (
                    <option key={l.lap} value={l.lap}>
                      Lap {l.lap} · {formatLapTime(l.duration)}
                      {l.isPitOut ? ' (out-lap)' : ''}
                    </option>
                  ))}
              </select>
            </fieldset>
            <fieldset>
              <legend style={{ color: B_COLOUR }}>Compare with lap B</legend>
              <select aria-label="Driver for lap B" value={b.driver ?? ''} onChange={(e) => setB(e.target.value === '' ? { driver: null, lap: null } : { driver: Number(e.target.value), lap: driverBest(Number(e.target.value)) })}>
                <option value="">None</option>
                {data.drivers.map((d) => (
                  <option key={d.number} value={d.number}>
                    {d.code} #{d.number}
                  </option>
                ))}
              </select>
              <select aria-label="Lap B" value={b.lap ?? ''} disabled={b.driver === null} onChange={(e) => setB({ ...b, lap: Number(e.target.value) })}>
                {lapsOf(b.driver)
                  .slice()
                  .sort((x, y) => compareTimes(x.duration, y.duration))
                  .map((l) => (
                    <option key={l.lap} value={l.lap}>
                      Lap {l.lap} · {formatLapTime(l.duration)}
                    </option>
                  ))}
              </select>
            </fieldset>
            <div className="f1-seg" role="group" aria-label="Horizontal axis">
              <button type="button" className={axis === 'distance' ? 'is-on' : ''} onClick={() => setAxis('distance')}>
                Distance
              </button>
              <button type="button" className={axis === 'time' ? 'is-on' : ''} onClick={() => setAxis('time')}>
                Time
              </button>
            </div>
          </div>

          <div className="f1-controls">
            <button
              type="button"
              className="f1-btn"
              disabled={a.driver === null || a.lap === null || !session}
              onClick={() => {
                if (!session || a.driver === null || a.lap === null) return
                const label = `${session.circuitName} ${session.name} ${session.year}`
                const code = (n: number): string | number => data.drivers.find((d) => d.number === n)?.code ?? n
                const vs = b.driver !== null && b.lap !== null ? ` vs ${code(b.driver)} L${b.lap}` : ''
                saved.save({
                  name: `${label}: ${code(a.driver)} L${a.lap}${vs}`,
                  sessionKey: session.key,
                  sessionLabel: label,
                  a: { driver: a.driver, lap: a.lap },
                  b: b.driver !== null && b.lap !== null ? { driver: b.driver, lap: b.lap } : null
                })
              }}
            >
              Save this comparison
            </button>
            {saved.items.length > 0 && (
              <label className="f1-pickrow">
                Saved
                <select
                  value=""
                  onChange={(e) => {
                    const c = saved.items.find((x) => x.name === e.target.value)
                    if (!c) return
                    const pa = { driver: c.a.driver, lap: c.a.lap }
                    const pb = c.b ? { driver: c.b.driver, lap: c.b.lap } : { driver: null, lap: null }
                    if (session?.key === c.sessionKey) {
                      setA(pa)
                      setB(pb)
                    } else setPendingLoad({ a: pa, b: pb })
                  }}
                >
                  <option value="">Open a saved comparison…</option>
                  {saved.items.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {(ta.load.state === 'loading' || tb.load.state === 'loading') && <p className="f1-note">Loading telemetry…</p>}
          {ta.load.state === 'error' && <p className="f1-note f1-bad">Telemetry for lap A could not be loaded: {ta.load.message}</p>}
          {tb.load.state === 'error' && <p className="f1-note f1-bad">Telemetry for lap B could not be loaded: {tb.load.message}</p>}
          {ta.load.state === 'ready' && !ta.trace && <p className="f1-note">The provider has no usable car readings for lap A.</p>}
          {why.map((w) => (
            <p key={w} className="f1-note f1-warn">
              {w}
            </p>
          ))}
          {(ta.trace?.sparse || tb.trace?.sparse) && <p className="f1-note f1-warn">Some readings are missing from this lap, so the traces have gaps.</p>}

          {ta.trace && (
            <div className="f1-telegrid">
              <div>
                <LineChart series={mk((p) => p.speed)} xLabel={axis === 'distance' ? 'Distance (derived from speed)' : 'Time into lap'} yLabel="Speed km/h" xFormat={xFormat} cursor={cursor} onCursor={setCursor} height={170} description="Speed through the lap" />
                <LineChart series={mk((p) => p.throttle)} xLabel="" yLabel="Throttle %" yDomain={[0, 100]} xFormat={xFormat} cursor={cursor} onCursor={setCursor} height={110} description="Throttle through the lap" />
                <LineChart series={mk((p) => (p.brake === null ? null : p.brake > 0 ? 1 : 0), true)} xLabel="" yLabel="Brake (on/off)" yDomain={[-0.1, 1.1]} yFormat={(y) => (y === 1 ? 'on' : y === 0 ? 'off' : '')} xFormat={xFormat} cursor={cursor} onCursor={setCursor} height={90} description="Brake application through the lap" />
                <LineChart series={mk((p) => p.gear, true)} xLabel="" yLabel="Gear" xFormat={xFormat} cursor={cursor} onCursor={setCursor} height={110} description="Gear through the lap" />
                <LineChart series={mk((p) => p.rpm)} xLabel="" yLabel="RPM" xFormat={xFormat} cursor={cursor} onCursor={setCursor} height={110} description="Engine speed through the lap" />
                <LineChart series={mk((p) => (p.drs === null ? null : p.drs >= 10 ? 1 : 0), true)} xLabel="" yLabel="DRS (open/closed)" yDomain={[-0.1, 1.1]} yFormat={(y) => (y === 1 ? 'open' : y === 0 ? 'closed' : '')} xFormat={xFormat} cursor={cursor} onCursor={setCursor} height={90} description="Whether the DRS flap was open" />
                {delta && <LineChart series={deltaSeries} zero xLabel="" yLabel="Time delta s (B − A)" yFormat={(y) => `${y > 0 ? '+' : ''}${y.toFixed(2)}`} xFormat={xFormat} cursor={cursor} onCursor={setCursor} height={130} description="How far lap B is ahead or behind lap A at each point of the lap" />}
              </div>
              <aside>
                <h2 className="f1-h">Track</h2>
                <TrackMap outline={ta.location.map((l) => ({ x: l.x, y: l.y }))} trail={trail} marker={marker} height={300} corners />
                <p className="f1-legend">The line is lap A, coloured slow (blue) to fast (red). The ring follows the cursor.</p>
                <h2 className="f1-h">Lap summaries</h2>
                <table className="f1-table">
                  <thead>
                    <tr>
                      <th />
                      <th className="num" style={{ color: A_COLOUR }}>
                        A
                      </th>
                      {sb && (
                        <th className="num" style={{ color: B_COLOUR }}>
                          B
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        ['Lap time', formatLapTime(ta.lap?.duration ?? null), formatLapTime(tb.lap?.duration ?? null)],
                        ['Top speed', sa?.maxSpeed !== null && sa ? `${sa.maxSpeed} km/h` : '–', sb?.maxSpeed !== null && sb ? `${sb.maxSpeed} km/h` : '–'],
                        ['Slowest', sa?.minSpeed !== null && sa ? `${sa.minSpeed} km/h` : '–', sb?.minSpeed !== null && sb ? `${sb.minSpeed} km/h` : '–'],
                        ['Full throttle', pct(sa?.fullThrottle ?? null), pct(sb?.fullThrottle ?? null)],
                        ['Braking', pct(sa?.braking ?? null), pct(sb?.braking ?? null)],
                        ['DRS open', pct(sa?.drsOpen ?? null), pct(sb?.drsOpen ?? null)],
                        ['Gear changes', sa ? String(sa.gearChanges) : '–', sb ? String(sb.gearChanges) : '–']
                      ] as [string, string, string][]
                    ).map(([k, va, vb]) => (
                      <tr key={k}>
                        <td>{k}</td>
                        <td className="num">{va}</td>
                        {sb && <td className="num">{vb}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {session && a.driver !== null && a.lap !== null && <Notes id={`telemetry-${session.key}-${a.driver}-${a.lap}`} label="Notes on this lap" />}
                <p className="f1-note">
                  Speed, throttle, brake, gear, RPM and DRS are the car&apos;s own readings. Distance is derived by adding up speed over time, so it is an estimate; laps
                  are lined up by fraction of the lap. The delta is the time difference at the same fraction of the lap.
                  {colourOf(a.driver) === colourOf(b.driver) && b.driver !== null ? ' Both laps are from the same team colour.' : ''}
                </p>
              </aside>
            </div>
          )}
        </>
      )}
    </>
  )
}
