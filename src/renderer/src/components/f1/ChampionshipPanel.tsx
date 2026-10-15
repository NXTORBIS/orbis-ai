import { useMemo, useState } from 'react'
import { applyScenario, contendersFrom, maxPerRound, possibility, rulesFor, type Possibility, type ScenarioRound } from '../../../../shared/f1/championship'
import { pointsProgression, type QualifyingRow, type SeasonRow } from '../../../../shared/f1/season'
import type { F1Answer, F1Race } from '../../../../shared/f1/types'
import { ChampionshipCharts } from './InsightPanels'
import { LineChart, type Series } from './Chart'
import { ExportButton, SourceLine, Waiting, useF1, type Load } from './shared'

interface SeasonData {
  results: SeasonRow[]
  sprints: SeasonRow[]
  qualifying: QualifyingRow[]
}

const PALETTE = ['#38e8ff', '#ffb03a', '#ff6b9a', '#8a6bff', '#5be28a', '#ffd34d', '#4d9bff', '#ff8a4d', '#c77dff', '#9aa4b2']
const WORDS: Record<Possibility, string> = {
  champion: 'Champion (cannot be caught)',
  possible: 'Still possible',
  'only-on-tiebreak': 'Only on a tie-break',
  out: 'Out of reach'
}

export default function ChampionshipPanel({ season, calendar }: { season: number; calendar: Load<F1Race[]> }): React.JSX.Element {
  const [load, retry] = useF1<SeasonData>(() => window.api.f1SeasonData(season) as Promise<F1Answer<SeasonData>>, [season])
  const [by, setBy] = useState<'driver' | 'constructor'>('driver')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const data = load.state === 'ready' ? load.answer.data : null
  const rows = useMemo(() => (data ? [...data.results, ...data.sprints] : []), [data])
  const standings = useMemo(() => contendersFrom(rows, by), [rows, by])
  const progression = useMemo(() => pointsProgression(rows, by), [rows, by])
  const rules = rulesFor(season)
  const lastRound = data ? Math.max(0, ...data.results.map((r) => r.round)) : 0
  const remaining = useMemo(() => {
    if (calendar.state !== 'ready') return []
    return calendar.answer.data
      .filter((r) => r.round > lastRound)
      .map((r) => ({ round: r.round, name: r.name, hasSprint: r.sessions.some((s) => /sprint/i.test(s.name) && !/qualifying|shootout/i.test(s.name)) }))
  }, [calendar, lastRound])

  if (load.state !== 'ready') return <Waiting load={load} retry={retry} what={`the ${season} results`} />
  if (!data || data.results.length === 0) return <p className="f1-note">No results have been published for {season} yet.</p>

  const shown = picked.size ? [...picked] : standings.slice(0, 6).map((s) => s.id)
  const series: Series[] = shown.map((id, i) => ({
    id,
    label: progression.get(id)?.name ?? id,
    colour: PALETTE[i % PALETTE.length],
    points: (progression.get(id)?.points ?? []).map((p) => ({ x: p.round, y: p.total }))
  }))
  const leader = standings[0]

  return (
    <>
      <div className="f1-controls">
        <div className="f1-seg" role="group" aria-label="Championship">
          <button type="button" className={by === 'driver' ? 'is-on' : ''} onClick={() => setBy('driver')}>
            Drivers
          </button>
          <button type="button" className={by === 'constructor' ? 'is-on' : ''} onClick={() => setBy('constructor')}>
            Constructors
          </button>
        </div>
        <ExportButton
          name={`${season}-${by}-championship`}
          header={['Position', 'Name', 'Points', 'Wins', 'Behind leader']}
          rows={standings.map((c, i) => [i + 1, c.name, c.points, c.wins, leader ? leader.points - c.points : null])}
        />
      </div>
      <SourceLine load={load} retry={retry} />
      <p className="f1-note">
        Standings after round {lastRound}, summed from the season&apos;s race and sprint results. Ties on points are ordered by wins and then second places, the official order;
        a tie those counts cannot separate is listed as tied.
      </p>

      <LineChart series={series} xLabel="Round" yLabel="Points" xFormat={(x) => `R${Math.round(x)}`} height={260} description={`Cumulative championship points after each round for ${by === 'driver' ? 'drivers' : 'constructors'}`} />
      <p className="f1-chips">
        {standings.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`f1-chip${shown.includes(c.id) ? ' is-on' : ''}`}
            aria-pressed={shown.includes(c.id)}
            onClick={() => setPicked((p) => { const n = new Set(p.size ? p : shown); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n })}
          >
            {c.name}
          </button>
        ))}
      </p>

      <h2 className="f1-h">What is still possible</h2>
      {!rules ? (
        <p className="f1-note f1-warn">
          Orbis has no recorded points rules for {season}, so it does not work out what is still possible: guessing with another era&apos;s table would give wrong answers.
        </p>
      ) : (
        <>
          <p className="f1-note">
            {rules.note} {remaining.length} round{remaining.length === 1 ? '' : 's'} left
            {remaining.length ? `, at most ${remaining.reduce((t, r) => t + maxPerRound(rules, r.hasSprint), 0)} points for a driver` : ''}. A contender is &quot;out of reach&quot; only
            when even every remaining maximum cannot get them level with the leader&apos;s points today.
          </p>
          <table className="f1-table">
            <thead>
              <tr>
                <th>Pos</th>
                <th>Name</th>
                <th className="num">Points</th>
                <th className="num">Behind</th>
                <th className="num">Can reach</th>
                <th>Title</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((c, i) => {
                const left = remaining.reduce((t, r) => t + maxPerRound(rules, r.hasSprint), 0)
                // Only a constructor team's two cars share the round maximum doubled; a driver gets the single maximum.
                const reach = c.points + left * (by === 'constructor' ? 2 : 1)
                const p = by === 'driver' ? possibility(c, standings, remaining, rules) : possibilityTeam(c.points, standings.map((s) => s.points), left * 2, c.id === leader.id)
                return (
                  <tr key={c.id}>
                    <td>{i + 1}</td>
                    <td>{c.name}</td>
                    <td className="num">{c.points}</td>
                    <td className="num">{i === 0 ? '–' : leader.points - c.points}</td>
                    <td className="num">{reach}</td>
                    <td>{WORDS[p]}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {remaining.length > 0 && by === 'driver' && <Scenario key={`${season}-${lastRound}`} standings={standings} remaining={remaining} season={season} hasSprintRules={rules.sprint.length > 0} />}
        </>
      )}
      <ChampionshipCharts season={season} />
    </>
  )
}

/** The same test for a team of two cars: each round can give up to twice the single-car maximum. */
function possibilityTeam(points: number, all: number[], left: number, isLeader: boolean): Possibility {
  const others = all.filter((_, i) => !(isLeader && i === 0))
  const best = Math.max(...(isLeader ? others : all))
  if (isLeader && points > Math.max(...others) + left) return 'champion'
  const reach = points + left
  if (reach > best) return 'possible'
  if (reach === best) return 'only-on-tiebreak'
  return 'out'
}

function Scenario({ standings, remaining, season, hasSprintRules }: { standings: ReturnType<typeof contendersFrom>; remaining: { round: number; name: string; hasSprint: boolean }[]; season: number; hasSprintRules: boolean }): React.JSX.Element {
  const rules = rulesFor(season)
  const top = standings.slice(0, 6)
  const [grid, setGrid] = useState<Record<number, Record<string, number>>>({})
  const [fastest, setFastest] = useState<Record<number, string>>({})
  if (!rules) return <></>

  const rounds: ScenarioRound[] = remaining.map((r) => ({ round: r.round, hasSprint: r.hasSprint && hasSprintRules, race: grid[r.round] ?? {}, sprint: {}, fastestLap: fastest[r.round] }))
  const result = applyScenario(standings, rounds, rules)
  const set = (round: number, id: string, v: string): void => setGrid((g) => ({ ...g, [round]: { ...(g[round] ?? {}), [id]: v === '' ? 0 : Number(v) } }))
  const taken = (round: number): number[] => Object.values(grid[round] ?? {}).filter((n) => n > 0)

  return (
    <section className="f1-calc">
      <h2 className="f1-h">What if… (hypothetical)</h2>
      <p className="f1-note f1-warn">
        This is a scenario you build, not a forecast and not a standing. Choose finishing places for the leading contenders in the remaining races; everyone else is left as they are.
        Two contenders cannot take the same place in a race.
      </p>
      <div className="f1-scroll">
        <table className="f1-table">
          <thead>
            <tr>
              <th>Race</th>
              {top.map((c) => (
                <th key={c.id}>{c.name.split(' ').slice(-1)[0]}</th>
              ))}
              {rules.fastestLapPoint && <th>Fastest lap</th>}
            </tr>
          </thead>
          <tbody>
            {remaining.slice(0, 6).map((r) => (
              <tr key={r.round}>
                <td>
                  R{r.round} <small>{r.name}</small>
                </td>
                {top.map((c) => (
                  <td key={c.id}>
                    <select aria-label={`${c.name}, ${r.name}`} value={grid[r.round]?.[c.id] ?? 0} onChange={(e) => set(r.round, c.id, e.target.value === '0' ? '' : e.target.value)}>
                      <option value={0}>–</option>
                      {Array.from({ length: 10 }, (_, i) => i + 1).map((p) => (
                        <option key={p} value={p} disabled={taken(r.round).includes(p) && grid[r.round]?.[c.id] !== p}>
                          P{p}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
                {rules.fastestLapPoint && (
                  <td>
                    <select aria-label={`Fastest lap, ${r.name}`} value={fastest[r.round] ?? ''} onChange={(e) => setFastest((f) => ({ ...f, [r.round]: e.target.value }))}>
                      <option value="">–</option>
                      {top.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name.split(' ').slice(-1)[0]}
                        </option>
                      ))}
                    </select>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {remaining.length > 6 && <p className="f1-note">The first six remaining races can be set; the rest stay as they are.</p>}
      <table className="f1-table">
        <thead>
          <tr>
            <th>Pos</th>
            <th>Name</th>
            <th className="num">Points</th>
            <th className="num">Change</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.slice(0, 10).map((r) => {
            const now = standings.find((s) => s.id === r.id)?.points ?? 0
            return (
              <tr key={r.id}>
                <td>
                  {r.position}
                  {r.tied ? ' (level)' : ''}
                </td>
                <td>{r.name}</td>
                <td className="num">{r.points}</td>
                <td className="num">{r.points - now > 0 ? `+${r.points - now}` : '–'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {result.unresolvedTies.length > 0 && (
        <p className="f1-note f1-warn">
          Level on points, wins and every finishing place counted, so the order between {result.unresolvedTies.map((g) => g.map((id) => standings.find((s) => s.id === id)?.name ?? id).join(' and ')).join('; ')} is not settled by the data Orbis holds.
        </p>
      )}
    </section>
  )
}
