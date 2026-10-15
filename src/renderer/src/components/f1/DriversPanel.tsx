import { useEffect, useMemo, useState } from 'react'
import { contendersFrom } from '../../../../shared/f1/championship'
import { driverSeasonStats, headToHead, pointsProgression, type CareerSeason, type QualifyingRow, type SeasonRow } from '../../../../shared/f1/season'
import type { F1Answer } from '../../../../shared/f1/types'
import { LineChart, type Series } from './Chart'
import { DriverInsights } from './InsightPanels'
import { ExportButton, SourceLine, Waiting, useF1, useWatchlist } from './shared'

interface SeasonData {
  results: SeasonRow[]
  sprints: SeasonRow[]
  qualifying: QualifyingRow[]
}

const f1 = (n: number | null, d = 1): string => (n === null ? '–' : n.toFixed(d))

export default function DriversPanel({ season }: { season: number }): React.JSX.Element {
  const [load, retry] = useF1<SeasonData>(() => window.api.f1SeasonData(season) as Promise<F1Answer<SeasonData>>, [season])
  const [selected, setSelected] = useState<string | null>(null)
  const [onlyWatched, setOnlyWatched] = useState(false)
  const watch = useWatchlist()

  const data = load.state === 'ready' ? load.answer.data : null
  const all = useMemo(() => (data ? [...data.results, ...data.sprints] : []), [data])
  const standings = useMemo(() => contendersFrom(all, 'driver'), [all])
  const list = standings.filter((c) => !onlyWatched || watch.has(c.id))

  useEffect(() => {
    if (standings.length && (selected === null || !standings.some((c) => c.id === selected))) setSelected(standings[0].id)
  }, [standings, selected])

  if (load.state !== 'ready') return <Waiting load={load} retry={retry} what={`the ${season} results`} />
  if (!data || data.results.length === 0) return <p className="f1-note">No results have been published for {season} yet.</p>

  return (
    <>
      <SourceLine load={load} retry={retry} />
      <div className="f1-split f1-drivers">
        <div>
          <div className="f1-controls">
            <label>
              <input type="checkbox" checked={onlyWatched} onChange={(e) => setOnlyWatched(e.target.checked)} /> Watchlist only ({watch.ids.length})
            </label>
          </div>
          <table className="f1-table f1-pick">
            <thead>
              <tr>
                <th />
                <th>Pos</th>
                <th>Driver</th>
                <th className="num">Wins</th>
                <th className="num">Pts</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const pos = standings.indexOf(c) + 1
                return (
                  <tr key={c.id} className={selected === c.id ? 'is-on' : ''} onClick={() => setSelected(c.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSelected(c.id)}>
                    <td>
                      <button
                        type="button"
                        className={`f1-star${watch.has(c.id) ? ' is-on' : ''}`}
                        aria-pressed={watch.has(c.id)}
                        aria-label={`${watch.has(c.id) ? 'Remove' : 'Add'} ${c.name} ${watch.has(c.id) ? 'from' : 'to'} the watchlist`}
                        onClick={(e) => {
                          e.stopPropagation()
                          watch.toggle(c.id)
                        }}
                      >
                        ★
                      </button>
                    </td>
                    <td>{pos}</td>
                    <td>{c.name}</td>
                    <td className="num">{c.wins}</td>
                    <td className="num">{c.points}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="f1-note">Points are summed from the season&apos;s race and sprint results. The watchlist is kept on this computer only.</p>
        </div>
        {selected && <Profile id={selected} data={data} season={season} standings={standings.map((s) => s.id)} />}
      </div>
    </>
  )
}

function Profile({ id, data, season, standings }: { id: string; data: SeasonData; season: number; standings: string[] }): React.JSX.Element {
  const rows = useMemo(() => [...data.results, ...data.sprints], [data])
  const mine = data.results.filter((r) => r.driverId === id).sort((a, b) => a.round - b.round)
  const sprint = data.sprints.filter((r) => r.driverId === id)
  const name = mine[0]?.driverName ?? id
  const teams = Array.from(new Set(mine.map((r) => r.constructorName)))
  const stats = driverSeasonStats(rows, id, data.qualifying)
  const progress = useMemo(() => pointsProgression(rows, 'driver'), [rows])
  const leaderId = standings[0]
  const mates = useMemo(() => {
    const set = new Map<string, string>()
    for (const r of data.results) {
      if (r.driverId === id) continue
      if (mine.some((m) => m.round === r.round && m.constructorId === r.constructorId)) set.set(r.driverId, r.driverName)
    }
    return [...set.entries()]
  }, [data, id, mine])
  const [mate, setMate] = useState<string | null>(null)
  useEffect(() => setMate(mates[0]?.[0] ?? null), [id, mates])

  const [career, retryCareer] = useF1<CareerSeason[]>(() => window.api.f1Career(id) as Promise<F1Answer<CareerSeason[]>>, [id])
  const h2h = mate ? headToHead(rows, data.qualifying, id, mate) : null
  const mateName = mates.find(([m]) => m === mate)?.[1] ?? ''

  const series: Series[] = [
    { id: 'me', label: name, colour: '#38e8ff', points: (progress.get(id)?.points ?? []).map((p) => ({ x: p.round, y: p.total })) },
    ...(leaderId !== id && progress.get(leaderId) ? [{ id: 'lead', label: `${progress.get(leaderId)?.name} (leader)`, colour: '#9aa4b2', dashed: true, points: (progress.get(leaderId)?.points ?? []).map((p) => ({ x: p.round, y: p.total })) }] : []),
    ...(mate && progress.get(mate) ? [{ id: 'mate', label: mateName, colour: '#ffb03a', points: (progress.get(mate)?.points ?? []).map((p) => ({ x: p.round, y: p.total })) }] : [])
  ]

  return (
    <div>
      <div className="f1-controls">
        <h2 className="f1-h" style={{ margin: 0 }}>
          {name} <small>· {teams.join(' / ')} · {season}</small>
        </h2>
        <ExportButton
          name={`${name}-${season}-results`}
          header={['Round', 'Grand Prix', 'Team', 'Grid', 'Finish', 'Status', 'Laps', 'Points']}
          rows={mine.map((r) => [r.round, r.raceName, r.constructorName, r.grid, r.positionText, r.status, r.laps, r.points])}
        />
      </div>

      <div className="f1-cards">
        {(
          [
            ['Entries', String(stats.entries)],
            ['Wins', String(stats.wins)],
            ['Podiums', String(stats.podiums)],
            ['Poles', String(stats.poles)],
            ['Points', String(stats.points)],
            ['Not classified', String(stats.dnfs)],
            ['Average finish', f1(stats.avgFinish)],
            ['Average grid', f1(stats.avgGrid)],
            ['Best finish', stats.bestFinish === null ? '–' : String(stats.bestFinish)],
            ['Points per race', f1(stats.pointsPerRace)]
          ] as [string, string][]
        ).map(([k, v]) => (
          <div key={k} className="f1-card">
            <small>{k}</small>
            <b>{v}</b>
          </div>
        ))}
      </div>
      <p className="f1-note">
        Average finish uses only races where the driver was classified; average grid skips pit-lane starts; poles are counted from qualifying where the provider lists it.
        Points include sprint points ({sprint.reduce((t, r) => t + r.points, 0)} here).
      </p>

      <DriverInsights rows={data.results} id={id} />

      <h2 className="f1-h">Points through the season</h2>
      <LineChart series={series} xLabel="Round" yLabel="Points" xFormat={(x) => `R${Math.round(x)}`} height={220} description={`${name}'s cumulative points after each round, with the leader and a teammate for comparison`} />

      <h2 className="f1-h">Results</h2>
      <table className="f1-table">
        <thead>
          <tr>
            <th className="num">Rd</th>
            <th>Grand Prix</th>
            <th>Team</th>
            <th className="num">Grid</th>
            <th className="num">Finish</th>
            <th>Status</th>
            <th className="num">Pts</th>
          </tr>
        </thead>
        <tbody>
          {mine.map((r) => (
            <tr key={r.round}>
              <td className="num">{r.round}</td>
              <td>{r.raceName}</td>
              <td>{r.constructorName}</td>
              <td className="num">{r.grid && r.grid > 0 ? r.grid : r.grid === 0 ? 'Pit' : '–'}</td>
              <td className="num">{r.positionText || '–'}</td>
              <td>{r.status}</td>
              <td className="num">
                {r.points}
                {sprint.find((s) => s.round === r.round) ? ` (+${sprint.find((s) => s.round === r.round)?.points} sprint)` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="f1-h">Against a teammate</h2>
      {mates.length === 0 ? (
        <p className="f1-note">No teammate shared a team with {name} in a round this season.</p>
      ) : (
        <>
          <label className="f1-pickrow">
            Teammate
            <select value={mate ?? ''} onChange={(e) => setMate(e.target.value)}>
              {mates.map(([m, n]) => (
                <option key={m} value={m}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {h2h && (
            <table className="f1-table">
              <thead>
                <tr>
                  <th />
                  <th className="num">{name.split(' ').slice(-1)[0]}</th>
                  <th className="num">{mateName.split(' ').slice(-1)[0]}</th>
                  <th className="num">Compared</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Qualifying (ahead)</td>
                  <td className="num">{h2h.qualifying.a}</td>
                  <td className="num">{h2h.qualifying.b}</td>
                  <td className="num">{h2h.qualifying.rounds} rounds</td>
                </tr>
                <tr>
                  <td>Race finish (ahead)</td>
                  <td className="num">{h2h.race.a}</td>
                  <td className="num">{h2h.race.b}</td>
                  <td className="num">{h2h.race.rounds} rounds</td>
                </tr>
                <tr>
                  <td>Rounds as teammates</td>
                  <td className="num" colSpan={3}>
                    {h2h.sharedRounds}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
          <p className="f1-note">
            Only rounds where both drove for the same team count. Qualifying compares classification positions. The race compares finishing positions where both were classified,
            because a retirement is not a comparable finish.
          </p>
        </>
      )}

      <h2 className="f1-h">Career</h2>
      {career.state !== 'ready' ? (
        <Waiting load={career} retry={retryCareer} what="the career" />
      ) : (
        <table className="f1-table">
          <thead>
            <tr>
              <th>Season</th>
              <th className="num">Pos</th>
              <th className="num">Points</th>
              <th className="num">Wins</th>
              <th>Team</th>
            </tr>
          </thead>
          <tbody>
            {career.answer.data
              .slice()
              .reverse()
              .map((c) => (
                <tr key={c.season}>
                  <td>{c.season}</td>
                  <td className="num">{c.position ?? '–'}</td>
                  <td className="num">{c.points}</td>
                  <td className="num">{c.wins}</td>
                  <td>{c.constructors.join(' / ') || '–'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
