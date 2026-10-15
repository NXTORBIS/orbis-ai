import { Download } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { circuitRecord, reportHtml, type CircuitRecord, type ConstructorRound, type Forecast, type QualifyingSession, type RadioClip, type ReportSection } from '../../../../shared/f1/extras'
import { safeFileName } from '../../../../shared/f1/csv'
import type { F1ConstructorStanding, F1Race, F1SessionTiming, F1Standings } from '../../../../shared/f1/types'
import { SessionPicker } from './SessionPicker'
import { ConstructorInsights } from './InsightPanels'
import { ExportButton, SourceLine, Waiting, useF1, usePrefs, when, type Load } from './shared'
import type { F1Session } from '../../../../shared/f1/types'

/** Saves what is on screen as one self-contained page (opens anywhere, prints to PDF). Nothing is sent anywhere. */
export function ReportButton({ title, sections, source }: { title: string; sections: ReportSection[]; source: string }): React.JSX.Element {
  const run = (): void => {
    const html = reportHtml(title, sections, { source, madeAt: new Date().toLocaleString() })
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeFileName(title)}.html`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }
  const [said, setSaid] = useState('')
  const pdf = (): void => {
    const html = reportHtml(title, sections, { source, madeAt: new Date().toLocaleString() })
    setSaid('Writing…')
    void window.api
      .f1ReportPdf(title, html)
      .then((r) => {
        const x = r as { ok?: boolean; data?: { path?: string }; message?: string }
        setSaid(x.ok && x.data?.path ? `Saved to ${x.data.path}` : x.message ?? 'The PDF could not be written.')
      })
      .catch(() => setSaid('The PDF could not be written.'))
  }
  return (
    <>
      <button type="button" className="f1-btn" onClick={run} title="Save a shareable report you can open or print to PDF">
        <Download size={14} /> Report
      </button>
      <button type="button" className="f1-btn" onClick={pdf} title="Write this report as a PDF into Downloads">
        <Download size={14} /> PDF
      </button>
      {said && <span className="f1-note" role="status">{said}</span>}
    </>
  )
}

// ---- constructors ----------------------------------------------------------------------------------------------------------

export function ConstructorsPanel({ season }: { season: number }): React.JSX.Element {
  const [stand, retryS] = useF1<F1Standings<F1ConstructorStanding> | null>(() => (window.api.f1Standings(season) as Promise<{ constructors: unknown }>).then((r) => r.constructors), [season])
  const rows = useMemo(() => {
    if (stand.state !== 'ready') return []
    return stand.answer.data?.rows ?? []
  }, [stand])
  const [id, setId] = useState('')
  useEffect(() => {
    if (!id && rows[0]?.constructor.id) setId(rows[0].constructor.id)
  }, [rows, id])
  const [load, retry] = useF1<ConstructorRound[]>(id ? () => window.api.f1ConstructorSeason(season, id) : null, [season, id])
  const chosen = rows.find((r) => r.constructor.id === id)
  const data = load.state === 'ready' ? load.answer.data : []
  return (
    <div>
      <SourceLine load={stand} retry={retryS} />
      <Waiting load={stand} retry={retryS} what="the constructors" />
      {rows.length > 0 && (
        <>
          <div className="f1-controls">
            <label>
              Team
              <select value={id} onChange={(e) => setId(e.target.value)}>
                {rows.map((r) => (
                  <option key={r.constructor.id ?? r.constructor.name} value={r.constructor.id ?? ''}>
                    {r.positionText}. {r.constructor.name}
                  </option>
                ))}
              </select>
            </label>
            {data.length > 0 && <ExportButton name={`${season}-${id}-rounds`} header={['Round', 'Race', 'Drivers (finish)', 'Points']} rows={data.map((r) => [r.round, r.race, r.entries.map((e) => `${e.driver} ${e.positionText}`).join(' / '), r.points])} />}
          </div>
          {chosen && (
            <p className="f1-headline">
              <span>
                Championship position <b>{chosen.positionText}</b>
              </span>
              <span>
                Points <b>{chosen.points}</b>
              </span>
              <span>
                Wins <b>{chosen.wins}</b>
              </span>
            </p>
          )}
          <Waiting load={load} retry={retry} what="the team’s season" />
          <ConstructorInsights season={season} ids={rows.filter((r) => r.constructor.id).map((r) => ({ id: r.constructor.id as string, name: r.constructor.name }))} />
          {load.state === 'ready' &&
            (data.length === 0 ? (
              <p className="f1-note">No race results are recorded for this team in {season} yet.</p>
            ) : (
              <table className="f1-table">
                <thead>
                  <tr>
                    <th>Round</th>
                    <th>Race</th>
                    <th>Drivers (grid → finish)</th>
                    <th className="num">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.round}>
                      <td>{r.round}</td>
                      <td>{r.race}</td>
                      <td>{r.entries.map((e) => `${e.driver} ${e.grid ?? '–'}→${e.positionText || '–'}${e.status && e.status !== 'Finished' && !/^\+/.test(e.status) ? ` (${e.status})` : ''}`).join('  ·  ')}</td>
                      <td className="num">{r.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
        </>
      )}
    </div>
  )
}

// ---- qualifying -------------------------------------------------------------------------------------------------------------

export function QualifyingPanel({ season, calendar }: { season: number; calendar: Load<F1Race[]> }): React.JSX.Element {
  const done = calendar.state === 'ready' ? calendar.answer.data.filter((r) => r.startsAt && Date.parse(r.startsAt) < Date.now()) : []
  const [round, setRound] = useState<number | null>(null)
  useEffect(() => {
    if (done.length && (round === null || !done.some((r) => r.round === round))) setRound(done[done.length - 1].round)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done.length, season])
  const [load, retry] = useF1<QualifyingSession | null>(round ? () => window.api.f1Qualifying(season, round) : null, [season, round])
  const q = load.state === 'ready' ? load.answer.data : null
  return (
    <div>
      <div className="f1-controls">
        <label>
          Race
          <select value={round ?? ''} onChange={(e) => setRound(Number(e.target.value))}>
            {done.map((r) => (
              <option key={r.round} value={r.round}>
                R{r.round} · {r.name}
              </option>
            ))}
          </select>
        </label>
        {q && (
          <>
            <ExportButton name={`${q.season}-R${q.round}-qualifying`} header={['Pos', 'Driver', 'Team', 'Q1', 'Q2', 'Q3']} rows={q.lines.map((l) => [l.position, l.driver, l.constructor, l.q1, l.q2, l.q3])} />
            <ReportButton
              title={`${q.race} ${q.season} qualifying`}
              source="Jolpica-F1"
              sections={[{ heading: `${q.race} · ${q.circuit}`, header: ['Pos', 'Driver', 'Team', 'Q1', 'Q2', 'Q3'], rows: q.lines.map((l) => [l.position, l.driver, l.constructor, l.q1, l.q2, l.q3]) }]}
            />
          </>
        )}
      </div>
      <SourceLine load={load} retry={retry} />
      <Waiting load={load} retry={retry} what="qualifying" />
      {load.state === 'ready' &&
        (!q || q.lines.length === 0 ? (
          <p className="f1-note">No qualifying result is recorded for that race.</p>
        ) : (
          <>
            <p className="f1-note">
              {q.race} · {q.circuit}. A blank Q2 or Q3 means the driver was knocked out before it. Qualifying results come from Jolpica-F1; the lap-by-lap detail is under Timing for 2023 on.
            </p>
            <table className="f1-table">
              <thead>
                <tr>
                  <th>Pos</th>
                  <th>Driver</th>
                  <th>Team</th>
                  <th className="num">Q1</th>
                  <th className="num">Q2</th>
                  <th className="num">Q3</th>
                  <th>Out in</th>
                </tr>
              </thead>
              <tbody>
                {q.lines.map((l) => (
                  <tr key={`${l.position}-${l.driver}`}>
                    <td>{l.position ?? '–'}</td>
                    <td>{l.driver}</td>
                    <td>{l.constructor}</td>
                    <td className="num">{l.q1 ?? '–'}</td>
                    <td className="num">{l.q2 ?? '–'}</td>
                    <td className="num">{l.q3 ?? '–'}</td>
                    <td>{l.reached === null ? 'No time' : l.reached === 3 ? 'Reached Q3' : `Q${l.reached}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ))}
    </div>
  )
}

// ---- circuits: records over the seasons, and the forecast ------------------------------------------------------------------

export function CircuitsPanel({ calendar }: { calendar: Load<F1Race[]> }): React.JSX.Element {
  const circuits = useMemo(() => {
    const m = new Map<string, string>()
    if (calendar.state === 'ready') for (const r of calendar.answer.data) if (r.circuitId) m.set(r.circuitId, r.circuitName)
    return [...m]
  }, [calendar])
  const [id, setId] = useState('')
  useEffect(() => {
    if (!id && circuits[0]) setId(circuits[0][0])
  }, [circuits, id])
  const [load, retry] = useF1<CircuitRecord[]>(id ? () => window.api.f1CircuitRecords(id) : null, [id])
  const rows = load.state === 'ready' ? load.answer.data : []
  const record = circuitRecord(rows)
  return (
    <div>
      <div className="f1-controls">
        <label>
          Circuit
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {circuits.map(([cid, name]) => (
              <option key={cid} value={cid}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {rows.length > 0 && <ExportButton name={`${id}-fastest-laps`} header={['Season', 'Race', 'Driver', 'Team', 'Lap', 'Time', 'Average speed km/h']} rows={rows.map((r) => [r.season, r.race, r.driver, r.constructor, r.lap, r.timeText, r.avgSpeedKph])} />}
      </div>
      <SourceLine load={load} retry={retry} />
      <Waiting load={load} retry={retry} what="the circuit’s fastest laps" />
      {load.state === 'ready' && (
        <>
          {record && (
            <p className="f1-headline">
              <span>
                Quickest race lap on record <b>{record.timeText}</b>
              </span>
              <span>
                <b>{record.driver}</b> ({record.constructor}), {record.season}
              </span>
              <span>{rows.length} races with a recorded fastest lap</span>
            </p>
          )}
          <p className="f1-note">
            The fastest lap of each race run here since fastest laps were recorded (2004). A lap time from a different layout or tyre era is not directly comparable; the record is the quickest time listed, not a statement about the cars.
          </p>
          <table className="f1-table">
            <thead>
              <tr>
                <th>Season</th>
                <th>Driver</th>
                <th>Team</th>
                <th className="num">Lap</th>
                <th className="num">Time</th>
                <th className="num">Avg km/h</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.season} className={r === record ? 'is-session' : ''}>
                  <td>{r.season}</td>
                  <td>{r.driver}</td>
                  <td>{r.constructor}</td>
                  <td className="num">{r.lap ?? '–'}</td>
                  <td className="num">{r.timeText ?? '–'}</td>
                  <td className="num">{r.avgSpeedKph ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

// ---- team radio -------------------------------------------------------------------------------------------------------------

export function RadioPanel({ year }: { year: number }): React.JSX.Element {
  const [session, setSession] = useState<F1Session | null>(null)
  const [load, retry] = useF1<RadioClip[]>(session ? () => window.api.f1TeamRadio(session.key) : null, [session?.key])
  const [timing] = useF1<F1SessionTiming>(session ? () => window.api.f1Timing(session.key, session.endsAt) : null, [session?.key])
  const names = useMemo(() => {
    const m = new Map<number, string>()
    if (timing.state === 'ready') for (const d of (timing.answer.data as { drivers?: { number: number; name: string; code: string }[] }).drivers ?? []) m.set(d.number, d.code || d.name)
    return m
  }, [timing])
  const [only, setOnly] = useState('')
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const clips = (load.state === 'ready' ? load.answer.data : []).filter((c) => !only || String(c.driverNumber) === only)
  const numbers = useMemo(() => [...new Set((load.state === 'ready' ? load.answer.data : []).map((c) => c.driverNumber))].sort((a, b) => a - b), [load])
  return (
    <div>
      {year < 2023 && <p className="f1-note">Team radio is listed by OpenF1 from 2023; choose 2023 or later.</p>}
      <SessionPicker year={Math.max(2023, year)} value={session} onChange={setSession} />
      <SourceLine load={load} retry={retry} />
      <Waiting load={load} retry={retry} what="team radio" />
      {load.state === 'ready' &&
        (load.answer.data.length === 0 ? (
          <p className="f1-note">No team-radio clips are listed for this session.</p>
        ) : (
          <>
            <div className="f1-controls">
              <label>
                Driver
                <select value={only} onChange={(e) => setOnly(e.target.value)}>
                  <option value="">All ({load.answer.data.length} clips)</option>
                  {numbers.map((n) => (
                    <option key={n} value={n}>
                      {names.get(n) ?? `#${n}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="f1-note">The clips are F1’s own recordings and play from F1’s servers; Orbis lists them and does not store them. Only the clips F1 published for the session are here: not every message was broadcast.</p>
            <audio ref={audio} onEnded={() => setPlaying(null)} onPause={() => setPlaying(null)} />
            <ul className="f1-calendar">
              {clips.map((c) => (
                <li key={c.url} className="f1-race">
                  <span className="f1-round">{names.get(c.driverNumber) ?? `#${c.driverNumber}`}</span>
                  <span>
                    <strong>{new Date(c.at).toLocaleTimeString()}</strong>
                    <small>{when(c.at)}</small>
                  </span>
                  <button
                    type="button"
                    className="f1-btn"
                    aria-pressed={playing === c.url}
                    onClick={() => {
                      const a = audio.current
                      if (!a) return
                      if (playing === c.url) {
                        a.pause()
                        return
                      }
                      a.src = c.url
                      void a.play().then(() => setPlaying(c.url)).catch(() => setPlaying(null))
                    }}
                  >
                    {playing === c.url ? 'Pause' : 'Play'}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ))}
    </div>
  )
}

// ---- alerts, and the next race's forecast ----------------------------------------------------------------------------------

export function AlertsPanel({ calendar }: { calendar: Load<F1Race[]> }): React.JSX.Element {
  const { prefs, setAlert, setLead } = usePrefs()
  const next = calendar.state === 'ready' ? calendar.answer.data.find((r) => r.startsAt && Date.parse(r.startsAt) > Date.now() - 3 * 3600_000) ?? null : null
  const canForecast = !!next && next.lat != null && next.long != null && !!next.startsAt && next.startsAt.length > 10 && Date.parse(next.startsAt) - Date.now() < 15 * 86_400_000
  const [fc, retry] = useF1<Forecast | null>(canForecast && next ? () => window.api.f1Forecast(next.lat as number, next.long as number, next.startsAt as string) : null, [next?.round, next?.season])
  return (
    <section className="f1-alerts" aria-label="Alerts and forecast">
      <h3 className="f1-h">Notify me</h3>
      <div className="f1-controls">
        <label>
          <input type="checkbox" checked={prefs.alerts.sessions} onChange={(e) => setAlert('sessions', e.target.checked)} /> A session is about to start
        </label>
        <label>
          <input type="checkbox" checked={prefs.alerts.results} onChange={(e) => setAlert('results', e.target.checked)} /> A race result is published
        </label>
        <label>
          How early
          <select value={prefs.leadMinutes} onChange={(e) => setLead(Number(e.target.value))}>
            {[5, 15, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n} minutes
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="f1-note">Orbis checks every few minutes while it is running, even with this screen closed. It can only say what the schedule and the results feed say, when they say it. The watchlist on the Drivers tab is mentioned in result alerts.</p>
      {next && (
        <>
          <h3 className="f1-h">
            Next: {next.name} · {next.circuitName}
          </h3>
          {!canForecast ? (
            <p className="f1-note">
              {next.startsAt && next.startsAt.length > 10 && Date.parse(next.startsAt) - Date.now() >= 15 * 86_400_000
                ? 'The race is more than two weeks away: a forecast does not reach that far.'
                : 'No forecast: the schedule has no exact start time or circuit position for this race yet.'}
            </p>
          ) : (
            <>
              <Waiting load={fc} retry={retry} what="the forecast" />
              {fc.state === 'ready' &&
                (fc.answer.data ? (
                  <p className="f1-headline">
                    <span>
                      At the start (UTC {new Date(fc.answer.data.at).toISOString().slice(11, 16)}): <b>{fc.answer.data.temperatureC ?? '–'}°C</b>
                    </span>
                    <span>
                      Rain chance <b>{fc.answer.data.rainChancePct ?? '–'}%</b>
                    </span>
                    <span>
                      Wind <b>{fc.answer.data.windKph ?? '–'} km/h</b>
                    </span>
                    <span>
                      Cloud <b>{fc.answer.data.cloudPct ?? '–'}%</b>
                    </span>
                    <span>Open-Meteo model forecast for the circuit’s position, not a track reading.</span>
                  </p>
                ) : (
                  <p className="f1-note">The forecast does not cover the start time.</p>
                ))}
            </>
          )}
        </>
      )}
    </section>
  )
}
