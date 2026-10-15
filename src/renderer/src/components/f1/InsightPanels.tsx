import { useMemo, useState } from 'react'
import { COVERAGE, constructorContribution, constructorDuel, coverageFor, driverConsistency, driverForm, leadGaps, positionProgression, seasonPercentiles, titleCounts, type ChampionRow } from '../../../../shared/f1/analysis'
import { contendersFrom } from '../../../../shared/f1/championship'
import { pointsProgression, type QualifyingRow, type SeasonRow } from '../../../../shared/f1/season'
import type { F1Answer } from '../../../../shared/f1/types'
import { LineChart, type Series } from './Chart'
import { ExportButton, SourceLine, Waiting, useF1 } from './shared'
import { ReportButton } from './ExtraPanels'

interface SeasonData {
  results: SeasonRow[]
  sprints: SeasonRow[]
  qualifying: QualifyingRow[]
}

const f = (n: number | null, d = 1): string => (n === null ? '–' : n.toFixed(d))
const COLOURS = ['#38e8ff', '#ffb03a', '#9aa4b2', '#ff6b6b', '#8a6bff', '#5be28a']

// ---- history ----------------------------------------------------------------------------------------------------------------

export function HistoryPanel({ season, onSeason }: { season: number; onSeason: (y: number) => void }): React.JSX.Element {
  const [one, retryOne] = useF1<{ champion: ChampionRow | null; runnerUp: ChampionRow | null; constructor: ChampionRow | null }>(() => window.api.f1Champions(season), [season])
  const [wantAll, setWantAll] = useState(false)
  const [all, retryAll] = useF1<{ drivers: ChampionRow[]; missing: number[] }>(wantAll ? () => window.api.f1Champions() : null, [wantAll])
  const [find, setFind] = useState('')
  const load = one
  const retry = retryOne
  const d = all.state === 'ready' ? all.answer.data : null
  const thisYear = new Date().getFullYear()
  const o = one.state === 'ready' ? one.answer.data : null
  const champ = o?.champion ?? null
  const second = o?.runnerUp ?? null
  const team = o?.constructor ?? null
  const rows = useMemo(() => (d?.drivers ?? []).filter((x) => !find.trim() || `${x.season} ${x.name} ${x.team ?? ''}`.toLowerCase().includes(find.trim().toLowerCase())), [d, find])
  const titles = useMemo(() => (d ? titleCounts(d.drivers.filter((x) => x.season < thisYear || x.rounds > 0)).slice(0, 10) : []), [d, thisYear])
  const cover = coverageFor(season)
  const margin = champ && second ? champ.points - second.points : null
  return (
    <div>
      <SourceLine load={load} retry={retry} />
      <Waiting load={load} retry={retry} what="the championship history" />
      <h2 className="f1-h">{season}</h2>
      {champ ? (
        <p className="f1-headline">
          <span>
            Drivers’ champion <b>{champ.name}</b>
            {champ.team ? ` (${champ.team})` : ''}
          </span>
          <span>
            <b>{champ.points}</b> points · <b>{champ.wins}</b> wins in {champ.rounds} rounds ({champ.rounds ? Math.round((champ.wins / champ.rounds) * 100) : 0}% of the races)
          </span>
          {second && (
            <span>
              Runner-up <b>{second.name}</b> ({second.points}){margin !== null ? `, ${margin} behind` : ''}
            </span>
          )}
          {team && (
            <span>
              Constructors’ champion <b>{team.name}</b> ({team.points})
            </span>
          )}
          {champ.season === thisYear && <span>The season is still in progress: this is the leader so far.</span>}
        </p>
      ) : (
        load.state === 'ready' && <p className="f1-note">No champion is recorded for {season}.</p>
      )}
      <div className="f1-controls">
        <button type="button" className="f1-btn" onClick={() => onSeason(season)}>
          This is the season selected at the top
        </button>
        {!wantAll && (
          <button type="button" className="f1-btn" onClick={() => setWantAll(true)}>
            Load every champion since 1950 (about a minute)
          </button>
        )}
        {d && (
          <ExportButton name="f1-champions" header={['Season', 'Champion', 'Team', 'Points', 'Wins', 'Rounds']} rows={d.drivers.map((x) => [x.season, x.name, x.team, x.points, x.wins, x.rounds])} />
        )}
        {d && (
          <ReportButton
            title="Formula 1 champions"
            source="Jolpica-F1"
            sections={[
              { heading: 'Drivers’ champions', note: 'Points were awarded under different systems in different eras, so points totals are not comparable across seasons.', header: ['Season', 'Champion', 'Team', 'Points', 'Wins', 'Rounds'], rows: d.drivers.map((x) => [x.season, x.name, x.team, x.points, x.wins, x.rounds]) },
              { heading: 'Titles', header: ['Driver', 'Titles', 'Seasons'], rows: titles.map((t) => [t.name, t.titles, t.seasons.join(', ')]) }
            ]}
          />
        )}
      </div>
      <h3 className="f1-h">What data exists for {season}</h3>
      <table className="f1-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>From</th>
            <th>Source</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {COVERAGE.map((c) => {
            const has = cover.includes(c)
            return (
              <tr key={c.what} style={has ? undefined : { opacity: 0.5 }}>
                <td>
                  {has ? '✓' : '–'} {c.what}
                </td>
                <td>{c.from}</td>
                <td>{c.source}</td>
                <td>{has ? c.note : `Not available for ${season}: it starts in ${c.from}.`}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {wantAll && <Waiting load={all} retry={retryAll} what="every champion" />}
      {d && d.missing.length > 0 && <p className="f1-note f1-warn">{d.missing.length} season{d.missing.length === 1 ? '' : 's'} could not be loaded: {d.missing.join(', ')}.</p>}
      {d && (
        <>
          <h3 className="f1-h">Most titles</h3>
          <table className="f1-table">
            <tbody>
              {titles.map((t) => (
                <tr key={t.name}>
                  <td>{t.name}</td>
                  <td className="num">{t.titles}</td>
                  <td>{t.seasons.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="f1-h">Every champion</h3>
          <input className="f1-search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search a year, driver or team" aria-label="Search champions" />
          <table className="f1-table">
            <thead>
              <tr>
                <th>Season</th>
                <th>Champion</th>
                <th>Team</th>
                <th className="num">Points</th>
                <th className="num">Wins</th>
                <th className="num">Races</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.season} className={x.season === season ? 'is-on' : ''} onClick={() => onSeason(x.season)} style={{ cursor: 'pointer' }}>
                  <td>{x.season}</td>
                  <td>{x.name}</td>
                  <td>{x.team ?? '–'}</td>
                  <td className="num">{x.points}</td>
                  <td className="num">{x.wins}</td>
                  <td className="num">{x.rounds || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="f1-note">
            Points are what each season’s own system awarded (8-6-4-3-2 in 1950, 25-18-15 now, with best-results rules in some years), so they cannot be compared across eras. Wins as a share of the season’s races can, which
            is why it is shown. Click a row to select that season for the other tabs.
          </p>
        </>
      )}
    </div>
  )
}

// ---- drivers: form, consistency, percentiles --------------------------------------------------------------------------------

export function DriverInsights({ rows, id }: { rows: SeasonRow[]; id: string }): React.JSX.Element {
  const form = driverForm(rows, id, 5)
  const c = driverConsistency(rows, id)
  const pct = useMemo(() => seasonPercentiles(rows), [rows])
  const me = pct.find((p) => p.driverId === id)
  return (
    <section>
      <h2 className="f1-h">Form and consistency</h2>
      <div className="f1-form" aria-label="The last five Grands Prix, newest first">
        {form.map((e) => (
          <span key={e.round} className={`f1-pip${e.classified ? '' : ' is-out'}`} title={`${e.raceName}: ${e.positionText}${e.grid ? ` from ${e.grid}` : ''}`}>
            {e.positionText}
          </span>
        ))}
        {form.length === 0 && <span className="f1-note">No Grands Prix yet.</span>}
      </div>
      <div className="f1-cards">
        {(
          [
            ['Finishes counted', String(c.n)],
            ['Median finish', f(c.median)],
            ['Spread (st. dev.)', c.stdev === null ? '– (fewer than 3)' : f(c.stdev)],
            ['Best / worst', c.best === null ? '–' : `${c.best} / ${c.worst}`],
            ['Average places gained', c.avgGain === null ? '–' : `${c.avgGain >= 0 ? '+' : ''}${c.avgGain.toFixed(1)}`],
            ['Biggest gain', c.bestGain ? `+${c.bestGain.places} (${c.bestGain.raceName})` : '–']
          ] as [string, string][]
        ).map(([k, v]) => (
          <div key={k} className="f1-card">
            <small>{k}</small>
            <b>{v}</b>
          </div>
        ))}
      </div>
      <h3 className="f1-h">Among this season’s drivers</h3>
      {me && (me.finish !== null || me.points !== null || me.grid !== null) ? (
        <p className="f1-headline">
          <span>
            Finishing position <b>{me.finish === null ? '–' : `percentile ${me.finish}`}</b>
          </span>
          <span>
            Points per race <b>{me.points === null ? '–' : `percentile ${me.points}`}</b>
          </span>
          <span>
            Grid slot <b>{me.grid === null ? '–' : `percentile ${me.grid}`}</b>
          </span>
        </p>
      ) : (
        <p className="f1-note">Not enough races, or fewer than five drivers with enough races, to place this driver.</p>
      )}
      <p className="f1-note">
        100 is best. A percentile is the share of the season’s other regular drivers this one is ahead of; ties count half. Only classified finishes count towards finishing position and the spread, a pit-lane start has
        no places gained, and a car’s quality is inside every one of these numbers: they describe results, not talent.
      </p>
    </section>
  )
}

// ---- teams: contribution and duel --------------------------------------------------------------------------------------------

export function ConstructorInsights({ season, ids }: { season: number; ids: { id: string; name: string }[] }): React.JSX.Element {
  const [load, retry] = useF1<SeasonData>(() => window.api.f1SeasonData(season) as Promise<F1Answer<SeasonData>>, [season])
  const [a, setA] = useState(ids[0]?.id ?? '')
  const [b, setB] = useState(ids[1]?.id ?? '')
  const rows = load.state === 'ready' ? [...load.answer.data.results, ...load.answer.data.sprints] : []
  const contrib = a ? constructorContribution(rows, a) : null
  const duel = a && b && a !== b ? constructorDuel(rows, a, b) : null
  const nameOf = (id: string): string => ids.find((x) => x.id === id)?.name ?? id
  return (
    <section>
      <h2 className="f1-h">Inside the team, and against another</h2>
      <Waiting load={load} retry={retry} what="the season’s results" />
      {load.state === 'ready' && (
        <>
          <div className="f1-controls">
            <label>
              Team
              <select value={a} onChange={(e) => setA(e.target.value)}>
                {ids.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Against
              <select value={b} onChange={(e) => setB(e.target.value)}>
                {ids.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {contrib && contrib.total > 0 && (
            <table className="f1-table">
              <thead>
                <tr>
                  <th>Driver (points, race and sprint)</th>
                  <th className="num">Points</th>
                  <th className="num">Share of the team’s</th>
                  <th className="num">Grands Prix</th>
                </tr>
              </thead>
              <tbody>
                {contrib.drivers.map((d) => (
                  <tr key={d.driverId}>
                    <td>{d.name}</td>
                    <td className="num">{d.points}</td>
                    <td className="num">{d.share === null ? '–' : `${Math.round(d.share * 100)}%`}</td>
                    <td className="num">{d.entries}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {duel && (
            <>
              <h3 className="f1-h">
                {nameOf(a)} v {nameOf(b)}
              </h3>
              <p className="f1-headline">
                <span>
                  Points <b>{duel.aPoints}</b> – <b>{duel.bPoints}</b>
                </span>
                <span>
                  Better best finish: <b>{duel.aAhead}</b> – <b>{duel.bAhead}</b>
                  {duel.level ? ` (${duel.level} level)` : ''}
                </span>
                <span>
                  Average grid <b>{f(duel.avgGridA)}</b> – <b>{f(duel.avgGridB)}</b>
                </span>
                <span>{duel.rounds} Grands Prix in which either entered</span>
              </p>
              <p className="f1-note">“Better best finish” compares each team’s best classified car in a round; rounds where either had no classified car are not counted. Pit-lane starts are left out of the grid average.</p>
            </>
          )}
        </>
      )}
    </section>
  )
}

// ---- championship: lead and position ----------------------------------------------------------------------------------------

export function ChampionshipCharts({ season }: { season: number }): React.JSX.Element | null {
  const [load, retry] = useF1<SeasonData>(() => window.api.f1SeasonData(season) as Promise<F1Answer<SeasonData>>, [season])
  const [by, setBy] = useState<'driver' | 'constructor'>('driver')
  const rows = useMemo(() => (load.state === 'ready' ? [...load.answer.data.results, ...load.answer.data.sprints] : []), [load])
  const progress = useMemo(() => pointsProgression(rows, by), [rows, by])
  const top = useMemo(
    () =>
      contendersFrom(rows, by)
        .slice(0, 5)
        .map((c) => c.id),
    [rows, by]
  )
  if (load.state !== 'ready') return <Waiting load={load} retry={retry} what="the championship charts" />
  if (rows.length === 0) return null
  const gaps = leadGaps(progress, top)
  const pos = positionProgression(progress, top)
  const gapSeries: Series[] = top.map((id, i) => ({ id, label: progress.get(id)?.name ?? id, colour: COLOURS[i % COLOURS.length], points: (gaps.get(id) ?? []).map((g) => ({ x: g.round, y: g.gap })) }))
  const posSeries: Series[] = top.map((id, i) => ({ id, label: progress.get(id)?.name ?? id, colour: COLOURS[i % COLOURS.length], step: true, points: (pos.get(id) ?? []).map((g) => ({ x: g.round, y: g.position })) }))
  const lastGap = top.map((id) => ({ name: progress.get(id)?.name ?? id, gap: gaps.get(id)?.slice(-1)[0]?.gap ?? null }))
  return (
    <section>
      <h2 className="f1-h">Lead and position through the season</h2>
      <div className="f1-seg" role="group" aria-label="Drivers or constructors">
        <button type="button" className={by === 'driver' ? 'is-on' : ''} onClick={() => setBy('driver')}>
          Drivers
        </button>
        <button type="button" className={by === 'constructor' ? 'is-on' : ''} onClick={() => setBy('constructor')}>
          Constructors
        </button>
      </div>
      <h3 className="f1-h">Points behind the leader</h3>
      <LineChart series={gapSeries} xLabel="Round" yLabel="Points behind" xFormat={(x) => `R${Math.round(x)}`} height={200} zero description={`Points behind the championship leader after each round for the top five ${by}s.`} />
      <h3 className="f1-h">Championship position</h3>
      <LineChart series={posSeries} xLabel="Round" yLabel="Position" xFormat={(x) => `R${Math.round(x)}`} yDomain={[0.5, 6.5]} height={200} description={`Championship position after each round for the top five ${by}s; 1 is the lead.`} />
      <p className="f1-note">
        Now: {lastGap.map((l) => `${l.name} ${l.gap === null ? '–' : l.gap === 0 ? 'leads' : `${l.gap} behind`}`).join(' · ')}. Built from each round’s own points; a tie shares the better position.
      </p>
    </section>
  )
}
