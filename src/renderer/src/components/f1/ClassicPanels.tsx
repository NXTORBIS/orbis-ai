import { useEffect, useMemo, useState } from 'react'
import { lapStats, sessionBest, sessionBestSectors } from '../../../../shared/f1/normalize'
import { compareTimes, formatDelta, formatLapTime } from '../../../../shared/f1/time'
import type {
  F1Answer,
  F1ConstructorStanding,
  F1DriverStanding,
  F1Lap,
  F1Race,
  F1RaceResult,
  F1Session,
  F1SessionTiming,
  F1Standings
} from '../../../../shared/f1/types'
import { ExportButton, PROVIDER_NAME, SourceLine, Waiting, useF1, when, type Load } from './shared'
import { ReportButton } from './ExtraPanels'

export function SeasonPanel({ calendar, retry, season }: { calendar: Load<F1Race[]>; retry: () => void; season: number }): React.JSX.Element {
  if (calendar.state !== 'ready') return <Waiting load={calendar} retry={retry} what={`the ${season} calendar`} />
  const races = calendar.answer.data
  const now = Date.now()
  const nextIndex = races.findIndex((r) => r.startsAt && Date.parse(r.startsAt) > now)
  return (
    <>
      <SourceLine load={calendar} retry={retry} />
      <ol className="f1-calendar">
        {races.map((r, i) => {
          const past = r.startsAt ? Date.parse(r.startsAt) <= now : false
          return (
            <li key={r.round} className={`f1-race${i === nextIndex ? ' is-next' : ''}${past ? ' is-past' : ''}`}>
              <span className="f1-round">R{r.round}</span>
              <div>
                <strong>{r.name}</strong>
                <small>
                  {r.circuitName}
                  {r.locality ? ` · ${r.locality}` : ''}
                  {r.country ? `, ${r.country}` : ''}
                </small>
                <small>{when(r.startsAt)}</small>
                {r.sessions.length > 0 && (
                  <details>
                    <summary>Weekend sessions</summary>
                    <ul>
                      {r.sessions.map((s) => (
                        <li key={s.name}>
                          {s.name}: {when(s.startsAt)}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              <span className="f1-badge">{i === nextIndex ? 'Next' : past ? 'Done' : 'Scheduled'}</span>
            </li>
          )
        })}
      </ol>
    </>
  )
}

interface StandingsAnswer {
  drivers: F1Answer<F1Standings<F1DriverStanding> | null>
  constructors: F1Answer<F1Standings<F1ConstructorStanding> | null>
}

export function StandingsPanel({ season, calendar }: { season: number; calendar: Load<F1Race[]> }): React.JSX.Element {
  const [round, setRound] = useState<number | null>(null)
  const [kind, setKind] = useState<'drivers' | 'constructors'>('drivers')
  useEffect(() => setRound(null), [season])
  // This channel answers with two answers (drivers, constructors), so it is read here rather than through useF1.
  const [pair, setPair] = useState<StandingsAnswer | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const retry = (): void => setTick((t) => t + 1)
  useEffect(() => {
    let live = true
    setPair(null)
    setProblem(null)
    window.api
      .f1Standings(season, round ?? undefined)
      .then((raw) => {
        if (!live) return
        const r = raw as Partial<StandingsAnswer> & { ok?: false; message?: string }
        if (r.drivers && r.constructors) setPair({ drivers: r.drivers, constructors: r.constructors })
        else setProblem(r.message ?? 'The standings could not be read.')
      })
      .catch((e: unknown) => live && setProblem(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [season, round, tick])
  const rounds = calendar.state === 'ready' ? calendar.answer.data.filter((r) => r.startsAt && Date.parse(r.startsAt) < Date.now()).map((r) => r.round) : []
  if (problem) return <Waiting load={{ state: 'error', message: problem }} retry={retry} what="the standings" />
  if (!pair) return <Waiting load={{ state: 'loading' }} retry={retry} what="the standings" />
  const chosen = kind === 'drivers' ? pair.drivers : pair.constructors
  return (
    <>
      <div className="f1-controls">
        <div role="tablist" className="f1-seg">
          {(['drivers', 'constructors'] as const).map((k) => (
            <button key={k} type="button" className={kind === k ? 'is-on' : ''} onClick={() => setKind(k)}>
              {k === 'drivers' ? 'Drivers' : 'Constructors'}
            </button>
          ))}
        </div>
        {chosen.ok && chosen.data && (
          <ExportButton
            name={`${season}-${kind}-standings-after-round-${chosen.data.round}`}
            header={kind === 'drivers' ? ['Position', 'Driver', 'Constructor', 'Wins', 'Points'] : ['Position', 'Constructor', 'Wins', 'Points']}
            rows={
              kind === 'drivers'
                ? (chosen.data as F1Standings<F1DriverStanding>).rows.map((r) => [r.positionText, r.driver.name, r.constructors.map((c) => c.name).join(' / '), r.wins, r.points])
                : (chosen.data as F1Standings<F1ConstructorStanding>).rows.map((r) => [r.positionText, r.constructor.name, r.wins, r.points])
            }
          />
        )}
        <label>
          After round
          <select value={round ?? ''} onChange={(e) => setRound(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">Latest</option>
            {rounds.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!chosen.ok ? (
        <p className="f1-note f1-bad">{chosen.message}</p>
      ) : !chosen.data ? (
        <p className="f1-note">There are no standings for {season} yet.</p>
      ) : (
        <>
          <p className={`f1-source is-${chosen.freshness}`}>
            {PROVIDER_NAME[chosen.source.provider]} · {chosen.freshness} · standing after round {chosen.data.round} of {season} ·{' '}
            {new Date(chosen.source.retrievedAt).toLocaleString()}
          </p>
          {kind === 'drivers' ? (
            <table className="f1-table">
              <thead>
                <tr>
                  <th>Pos</th>
                  <th>Driver</th>
                  <th>Constructor</th>
                  <th className="num">Wins</th>
                  <th className="num">Points</th>
                </tr>
              </thead>
              <tbody>
                {(chosen.data as F1Standings<F1DriverStanding>).rows.map((r) => (
                  <tr key={r.driver.id ?? r.driver.name}>
                    <td>{r.positionText}</td>
                    <td>{r.driver.name}</td>
                    <td>{r.constructors.map((c) => c.name).join(' / ') || '–'}</td>
                    <td className="num">{r.wins}</td>
                    <td className="num">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="f1-table">
              <thead>
                <tr>
                  <th>Pos</th>
                  <th>Constructor</th>
                  <th className="num">Wins</th>
                  <th className="num">Points</th>
                </tr>
              </thead>
              <tbody>
                {(chosen.data as F1Standings<F1ConstructorStanding>).rows.map((r) => (
                  <tr key={r.constructor.id ?? r.constructor.name}>
                    <td>{r.positionText}</td>
                    <td>{r.constructor.name}</td>
                    <td className="num">{r.wins}</td>
                    <td className="num">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  )
}

export function ResultsPanel({ season, calendar }: { season: number; calendar: Load<F1Race[]> }): React.JSX.Element {
  const [round, setRound] = useState<number | 'last'>('last')
  useEffect(() => setRound('last'), [season])
  const [load, retry] = useF1<F1RaceResult | null>(() => window.api.f1Results(season, round), [season, round])
  const done = calendar.state === 'ready' ? calendar.answer.data.filter((r) => r.startsAt && Date.parse(r.startsAt) < Date.now()) : []
  return (
    <>
      <div className="f1-controls">
        <label>
          Race
          <select value={round} onChange={(e) => setRound(e.target.value === 'last' ? 'last' : Number(e.target.value))}>
            <option value="last">Most recent</option>
            {done.map((r) => (
              <option key={r.round} value={r.round}>
                R{r.round} · {r.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {load.state !== 'ready' ? (
        <Waiting load={load} retry={retry} what="the results" />
      ) : !load.answer.data ? (
        <p className="f1-note">No result is published for that race yet.</p>
      ) : (
        <>
          <SourceLine load={load} retry={retry} />
          <div className="f1-controls">
            <h2 className="f1-h" style={{ margin: 0 }}>
              {load.answer.data.race.name} · {load.answer.data.race.circuitName}
            </h2>
            <ExportButton
              name={`${load.answer.data.race.season}-R${load.answer.data.race.round}-${load.answer.data.race.name}-results`}
              header={['Position', 'Driver', 'Constructor', 'Grid', 'Laps', 'Time or status', 'Fastest lap', 'Points']}
              rows={load.answer.data.rows.map((r) => [r.positionText, r.driver.name, r.constructor.name, r.grid, r.laps, r.timeText ?? r.status, r.fastestLap?.timeText ?? null, r.points])}
            />
            <ReportButton
              title={`${load.answer.data.race.season} ${load.answer.data.race.name} results`}
              source="Jolpica-F1"
              sections={[
                {
                  heading: `${load.answer.data.race.name} · ${load.answer.data.race.circuitName}`,
                  note: `Round ${load.answer.data.race.round} of ${load.answer.data.race.season}.`,
                  header: ['Position', 'Driver', 'Constructor', 'Grid', 'Laps', 'Time or status', 'Fastest lap', 'Points'],
                  rows: load.answer.data.rows.map((r) => [r.positionText, r.driver.name, r.constructor.name, r.grid, r.laps, r.timeText ?? r.status, r.fastestLap?.timeText ?? null, r.points])
                }
              ]}
            />
          </div>
          <table className="f1-table">
            <thead>
              <tr>
                <th>Pos</th>
                <th>Driver</th>
                <th>Constructor</th>
                <th className="num">Grid</th>
                <th className="num">Laps</th>
                <th>Time / status</th>
                <th>Fastest lap</th>
                <th className="num">Pts</th>
              </tr>
            </thead>
            <tbody>
              {load.answer.data.rows.map((r) => (
                <tr key={`${r.driver.id}-${r.positionText}`}>
                  <td>{r.positionText}</td>
                  <td>{r.driver.name}</td>
                  <td>{r.constructor.name}</td>
                  <td className="num">{r.grid ?? '–'}</td>
                  <td className="num">{r.laps ?? '–'}</td>
                  <td>{r.timeText ?? r.status}</td>
                  <td>{r.fastestLap?.timeText ? `${r.fastestLap.timeText}${r.fastestLap.lap ? ` (lap ${r.fastestLap.lap})` : ''}` : '–'}</td>
                  <td className="num">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  )
}

export function TimingPanel({ season }: { season: number }): React.JSX.Element {
  const [sessions, reloadSessions] = useF1<F1Session[]>(() => window.api.f1Sessions(season), [season])
  const [key, setKey] = useState<number | null>(null)
  const [driver, setDriver] = useState<number | null>(null)
  useEffect(() => {
    setKey(null)
    setDriver(null)
  }, [season])
  const finished = useMemo(
    () => (sessions.state === 'ready' ? sessions.answer.data.filter((s) => Date.parse(s.startsAt) < Date.now()).reverse() : []),
    [sessions]
  )
  useEffect(() => {
    if (key === null && finished.length > 0) setKey(finished[0].key)
  }, [finished, key])
  const chosen = finished.find((s) => s.key === key) ?? null
  const [timing, retry] = useF1<F1SessionTiming>(chosen ? () => window.api.f1Timing(chosen.key, chosen.endsAt) : null, [chosen?.key])

  if (sessions.state !== 'ready') return <Waiting load={sessions} retry={reloadSessions} what={`the ${season} sessions`} />
  if (season < 2023) return <p className="f1-note">Lap timing is available from 2023.</p>
  return (
    <>
      <div className="f1-controls">
        <label>
          Session
          <select value={key ?? ''} onChange={(e) => setKey(Number(e.target.value))}>
            {finished.map((s) => (
              <option key={s.key} value={s.key}>
                {s.circuitName} · {s.name} · {new Date(s.startsAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </label>
      </div>
      {finished.length === 0 && <p className="f1-note">No session of {season} has taken place yet.</p>}
      {chosen && timing.state !== 'ready' && <Waiting load={timing} retry={retry} what="the lap timing" />}
      {chosen && timing.state === 'ready' && <TimingTable data={timing.answer.data} load={timing} retry={retry} driver={driver} setDriver={setDriver} />}
    </>
  )
}

function TimingTable({
  data,
  load,
  retry,
  driver,
  setDriver
}: {
  data: F1SessionTiming
  load: Load<F1SessionTiming>
  retry: () => void
  driver: number | null
  setDriver: (n: number) => void
}): React.JSX.Element {
  const best = useMemo(() => sessionBest(data.laps), [data.laps])
  const bestSectors = useMemo(() => sessionBestSectors(data.laps), [data.laps])
  const rows = useMemo(
    () =>
      data.drivers
        .map((d) => ({ d, s: lapStats(data.laps, d.number) }))
        .filter((r) => r.s.lapsRecorded > 0)
        .sort((a, b) => compareTimes(a.s.best?.duration ?? null, b.s.best?.duration ?? null)),
    [data]
  )
  const selected = driver ?? rows[0]?.d.number ?? null
  const mine: F1Lap[] = data.laps.filter((l) => l.driverNumber === selected)
  const personalBest = selected !== null ? lapStats(data.laps, selected) : null
  const sec = (v: number | null, bestOverall: number | null, personal: number | null): string =>
    v === null ? '' : bestOverall !== null && v === bestOverall ? 'is-session' : personal !== null && v === personal ? 'is-personal' : ''
  return (
    <>
      <SourceLine load={load} retry={retry} />
      <p className="f1-note">
        Best laps use laps with a recorded time that are not out-laps. {best ? `Session best: ${formatLapTime(best.duration)} (${data.drivers.find((d) => d.number === best.driverNumber)?.code ?? best.driverNumber}, lap ${best.lap}).` : 'No eligible lap was recorded.'}
      </p>
      <div className="f1-split">
        <table className="f1-table f1-pick">
          <thead>
            <tr>
              <th>Driver</th>
              <th>Team</th>
              <th className="num">Best</th>
              <th className="num">Gap</th>
              <th className="num">Median</th>
              <th className="num">Laps</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ d, s }) => (
              <tr key={d.number} className={selected === d.number ? 'is-on' : ''} onClick={() => setDriver(d.number)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setDriver(d.number)}>
                <td>
                  <span className="f1-swatch" style={{ background: d.colour ? `#${d.colour}` : 'transparent' }} aria-hidden="true" />
                  {d.code} <small>#{d.number}</small>
                </td>
                <td>{d.team ?? '–'}</td>
                <td className="num">{formatLapTime(s.best?.duration ?? null)}</td>
                <td className="num">{formatDelta(s.best?.duration ?? null, best?.duration ?? null)}</td>
                <td className="num">{formatLapTime(s.median)}</td>
                <td className="num">{s.lapsEligible}/{s.lapsRecorded}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div>
          <div className="f1-controls">
            <h2 className="f1-h" style={{ margin: 0 }}>{data.drivers.find((d) => d.number === selected)?.name ?? 'Driver'} · every lap</h2>
            <ExportButton
              name={`${data.session.circuitName}-${data.session.name}-${data.drivers.find((d) => d.number === selected)?.code ?? selected}-laps`}
              header={['Lap', 'Time (s)', 'Sector 1 (s)', 'Sector 2 (s)', 'Sector 3 (s)', 'Out-lap', 'Speed trap km/h']}
              rows={mine.map((l) => [l.lap, l.duration, l.sectors[0], l.sectors[1], l.sectors[2], l.isPitOut, l.speeds.finishLine])}
            />
          </div>
          <table className="f1-table">
            <thead>
              <tr>
                <th className="num">Lap</th>
                <th className="num">Time</th>
                <th className="num">vs own best</th>
                <th className="num">S1</th>
                <th className="num">S2</th>
                <th className="num">S3</th>
                <th className="num">Trap km/h</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((l) => (
                <tr key={l.lap}>
                  <td className="num">
                    {l.lap}
                    {l.isPitOut ? ' · out' : ''}
                  </td>
                  <td className={`num ${best && l.duration === best.duration && !l.isPitOut ? 'is-session' : personalBest?.best && l.duration === personalBest.best.duration ? 'is-personal' : ''}`}>
                    {formatLapTime(l.duration)}
                  </td>
                  <td className="num">{formatDelta(l.duration, personalBest?.best?.duration ?? null)}</td>
                  {([0, 1, 2] as const).map((i) => (
                    <td key={i} className={`num ${sec(l.sectors[i], bestSectors[i], personalBest?.bestSectors[i] ?? null)}`}>
                      {formatLapTime(l.sectors[i])}
                    </td>
                  ))}
                  <td className="num">{l.speeds.finishLine ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="f1-legend">
            <span className="is-session">Session best</span> <span className="is-personal">Personal best</span> · a dash means the provider recorded no value.
          </p>
        </div>
      </div>
    </>
  )
}

