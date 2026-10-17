import { useEffect, useMemo, useRef, useState } from 'react'
import { LEAGUES, leagueById, seasonLabel } from '../../../../shared/football/leagues'
import {
  clockLabel,
  computeTable,
  diffMatch,
  evaluateModel,
  goalTiming,
  headToHead,
  normalizeEvents,
  poissonOutcome,
  reconcileScore,
  resultDistribution,
  split,
  teamResults,
  topScorers,
  type FbChange
} from '../../../../shared/football/logic'
import { byLocalDay, narrative, rollingPoints, seasonInsights } from '../../../../shared/football/insights'
import { statShare, type FbMatchExtras, type FbTeamProfile } from '../../../../shared/football/extras'
import { isLive, type FbLeague, type FbMatch, type FbStandingRow } from '../../../../shared/football/types'
import { EventStrip, LineupPitch, Replay, useReducedMotion } from './MatchViews'
import { Crest, Fresh, MatchRow, SourceLine, Waiting, useFb, useFollows, type Load } from './shared'
import { SearchBox } from '../../ui'

const DAY = 86_400_000
/** The newest row of each match the Now list has shown: a single-match lookup can lack the minute a live list carried. */
const LAST_SEEN = new Map<string, FbMatch>()
const ts = (m: FbMatch): number => (m.kickoff ? Date.parse(m.kickoff) : Infinity)

/** A short sentence per change, from what the provider's records actually showed. */
function say(c: FbChange): string {
  const t = `${c.match.home.name} – ${c.match.away.name}`
  switch (c.kind) {
    case 'kickoff':
      return `${t}: kick-off`
    case 'goal':
      return `${t}: goal${c.event?.player ? ` (${c.event.player})` : ''}, now ${c.score.home}–${c.score.away}`
    case 'goal-withdrawn':
      return `${t}: a goal was withdrawn`
    case 'half-time':
      return `${t}: half-time`
    case 'full-time':
      return `${t}: full-time ${c.match.score.home}–${c.match.score.away}`
    case 'score-correction':
      return `${t}: the score was corrected (was ${c.from.home}–${c.from.away})`
    default:
      return `${t}: now ${c.match.status}`
  }
}

// ---- Now -------------------------------------------------------------------------------------------------------------------

export function NowPanel({ onOpen, selected }: { onOpen: (key: string) => void; selected: string | null }): React.JSX.Element {
  const [load, retry] = useFb<FbMatch[]>(() => window.api.footballLive(), [], 30_000)
  const follows = useFollows()
  const [q, setQ] = useState('')
  const [onlyFollowed, setOnlyFollowed] = useState(false)
  const [alerts, setAlerts] = useState<string[]>([])
  const seen = useRef<Map<string, FbMatch>>(new Map())

  // What changed between two answers is announced here, in this screen. The first answer announces nothing.
  useEffect(() => {
    if (load.state !== 'ready') return
    const found: string[] = []
    for (const m of load.answer.data) {
      for (const c of diffMatch(seen.current.get(m.key) ?? null, m)) found.push(say(c))
      seen.current.set(m.key, m)
    }
    if (found.length) setAlerts((a) => [...found, ...a].slice(0, 20))
  }, [load])

  const all = load.state === 'ready' ? load.answer.data : []
  for (const m of all) LAST_SEEN.set(m.key, m)
  const now = Date.now()
  const match = (m: FbMatch): boolean => {
    if (onlyFollowed && !follows.teams.includes(m.home.id) && !follows.teams.includes(m.away.id) && !follows.pins.includes(m.key)) return false
    const st = follows.data.ui.status
    if (st === 'live' && !isLive(m.status)) return false
    if (st === 'upcoming' && m.status !== 'scheduled') return false
    if (st === 'finished' && m.status !== 'finished') return false
    const s = q.trim().toLowerCase()
    return !s || `${m.home.name} ${m.away.name} ${m.competition.name}`.toLowerCase().includes(s)
  }
  const sortBy = follows.data.ui.sort
  const order = (a: FbMatch, b: FbMatch, dir: 1 | -1): number =>
    sortBy === 'competition' ? a.competition.name.localeCompare(b.competition.name) || dir * (ts(a) - ts(b)) : sortBy === 'kickoff' ? dir * (ts(a) - ts(b)) : (a.liveBasis === 'reported' ? 0 : 1) - (b.liveBasis === 'reported' ? 0 : 1) || a.competition.name.localeCompare(b.competition.name) || dir * (ts(a) - ts(b))
  const list = all.filter(match)
  const liveNow = list.filter((m) => isLive(m.status)).sort((a, b) => order(a, b, 1))
  const soon = list.filter((m) => m.status === 'scheduled' && ts(m) - now < 2 * DAY).sort((a, b) => ts(a) - ts(b))
  const recent = list.filter((m) => m.status === 'finished' && now - ts(m) < 2 * DAY).sort((a, b) => (sortBy === 'competition' ? order(a, b, -1) : ts(b) - ts(a)))
  const teams = useMemo(() => {
    const t = new Map<string, string>()
    for (const m of all) {
      t.set(m.home.id, m.home.name)
      t.set(m.away.id, m.away.name)
    }
    return [...t].sort((a, b) => a[1].localeCompare(b[1]))
  }, [all])

  return (
    <div>
      <div className="fb-sourcebar">
        <SearchBox value={q} onChange={setQ} label="Search matches" placeholder="Search a team or competition" className="fb-find" />
        <label className="fb-check">
          <input type="checkbox" checked={onlyFollowed} onChange={(e) => setOnlyFollowed(e.target.checked)} /> Followed teams and pinned matches only
        </label>
        <select value="" onChange={(e) => e.target.value && follows.toggleTeam(e.target.value, teams.find((t) => t[0] === e.target.value)?.[1] ?? e.target.value)} aria-label="Follow or unfollow a team">
          <option value="">Follow a team…</option>
          {teams.map(([id, name]) => (
            <option key={id} value={id}>
              {follows.teams.includes(id) ? '✓ ' : ''}
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="fb-sourcebar" role="group" aria-label="Show">
        <label className="fb-inline">
          Show
          <select value={follows.data.ui.status} onChange={(e) => follows.setUi({ status: e.target.value as 'all' | 'live' | 'upcoming' | 'finished' })}>
            <option value="all">Everything</option>
            <option value="live">Live only</option>
            <option value="upcoming">Upcoming only</option>
            <option value="finished">Finished only</option>
          </select>
        </label>
        <label className="fb-inline">
          Order
          <select value={follows.data.ui.sort} onChange={(e) => follows.setUi({ sort: e.target.value as 'live' | 'kickoff' | 'competition' })}>
            <option value="live">Reported live first</option>
            <option value="kickoff">Kick-off time</option>
            <option value="competition">Competition</option>
          </select>
        </label>
        <label className="fb-inline">
          Times in
          <select value={follows.data.ui.timeZone ?? ''} onChange={(e) => follows.setUi({ timeZone: e.target.value || null })}>
            <option value="">This computer</option>
            {['UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'].map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
        <label className="fb-check">
          <input type="checkbox" checked={follows.data.ui.compact} onChange={(e) => follows.setUi({ compact: e.target.checked })} /> Compact rows
        </label>
        <label className="fb-check">
          <input type="checkbox" checked={follows.data.ui.reduceMotion} onChange={(e) => follows.setUi({ reduceMotion: e.target.checked })} /> Reduce motion
        </label>
        <label className="fb-check">
          <input type="checkbox" checked={follows.data.ui.intro} onChange={(e) => follows.setUi({ intro: e.target.checked })} /> Opening scene
        </label>
      </div>
      {follows.data.ui.recent.length > 0 && (
        <p className="fb-note">
          Recently opened:{' '}
          {follows.data.ui.recent.slice(0, 5).map((r) => (
            <button key={r.key} type="button" className="fb-linkbtn" onClick={() => onOpen(r.key)} style={{ marginRight: 10 }}>
              {r.title}
            </button>
          ))}
        </p>
      )}
      <section className="fb-alerts" aria-label="Notifications">
        <h3 className="fb-h">Notify me</h3>
        <div className="fb-sourcebar">
          {(['goals', 'kickoff', 'fulltime'] as const).map((k) => (
            <label key={k} className="fb-check">
              <input type="checkbox" checked={follows.data.alerts[k]} onChange={(e) => follows.setAlert(k, e.target.checked)} /> {k === 'goals' ? 'Goals' : k === 'kickoff' ? 'Kick-off' : 'Full-time'}
            </label>
          ))}
        </div>
        <p className="fb-note">
          For {follows.data.teams.length} followed team{follows.data.teams.length === 1 ? '' : 's'}, {follows.data.pins.length} pinned match{follows.data.pins.length === 1 ? '' : 'es'} and {follows.data.reminders.length} reminder{follows.data.reminders.length === 1 ? '' : 's'}. Orbis checks about once a minute while it is running, even when this screen is closed, and says each thing once. It can only tell you what the providers report, as soon as they report it.
        </p>
        {follows.data.teams.length > 0 && <p className="fb-note">Following: {follows.data.teams.map((t) => t.name).join(', ')}</p>}
        {follows.data.reminders.length > 0 && (
          <ul className="fb-reminders">
            {follows.data.reminders.map((r) => (
              <li key={`${r.key}${r.minutes}`}>
                {r.title} · {r.minutes} min before ({new Date(r.kickoff).toLocaleString()})
                <button type="button" className="fb-link" onClick={() => follows.setReminder(r.key, r.title, r.kickoff, null)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <SourceLine load={load} retry={retry} />
      <Waiting load={load} retry={retry} what="live matches" />
      {alerts.length > 0 && (
        <section className="fb-alerts" aria-live="polite" aria-label="What just changed">
          <h3 className="fb-h">Just changed</h3>
          <ul>
            {alerts.slice(0, 6).map((a, i) => (
              <li key={`${i}-${a}`}>{a}</li>
            ))}
          </ul>
        </section>
      )}
      {load.state === 'ready' && (
        <>
          <h3 className="fb-h">Live now · {liveNow.length}</h3>
          {liveNow.length === 0 ? (
            <p className="fb-note">No match is live right now. This list is built from what the providers report; a competition they do not cover will not appear here.</p>
          ) : (
            <ul className="fb-list">
              {liveNow.map((m) => (
                <MatchRow key={m.key} m={m} onOpen={onOpen} pinned={follows.pins.includes(m.key)} selected={selected === m.key} />
              ))}
            </ul>
          )}
          <h3 className="fb-h">Starting within two days · {soon.length}</h3>
          {soon.length === 0 ? <p className="fb-note">Nothing scheduled in these competitions in the next two days.</p> : <ul className="fb-list">{soon.map((m) => <MatchRow key={m.key} m={m} onOpen={onOpen} pinned={follows.pins.includes(m.key)} selected={selected === m.key} />)}</ul>}
          <h3 className="fb-h">Recent results · {recent.length}</h3>
          {recent.length === 0 ? <p className="fb-note">No results from the last two days in these competitions.</p> : <ul className="fb-list">{recent.map((m) => <MatchRow key={m.key} m={m} onOpen={onOpen} pinned={follows.pins.includes(m.key)} selected={selected === m.key} />)}</ul>}
          <p className="fb-note">
            Matches marked “inferred” come from OpenLigaDB, which has no live flag: Orbis shows them as under way because they are unfinished and kicked off within the last 2¾ hours. No minute is shown for them.
          </p>
        </>
      )}
    </div>
  )
}

// ---- a competition and a season ---------------------------------------------------------------------------------------------

export interface Pick {
  league: FbLeague
  season: string
}

export function useSeasonMatches(p: Pick): [Load<FbMatch[]>, () => void] {
  return useFb<FbMatch[]>(() => window.api.footballSeason(p.league.id, p.season), [p.league.id, p.season])
}

export function FixturesPanel({ pick, onOpen, selected }: { pick: Pick; onOpen: (key: string) => void; selected: string | null }): React.JSX.Element {
  const [load, retry] = useSeasonMatches(pick)
  const [round, setRound] = useState<string>('')
  const ms = load.state === 'ready' ? load.answer.data : []
  const rounds = useMemo(() => {
    const seen = new Map<string, number>()
    for (const m of ms) if (m.round) seen.set(m.round, Math.min(seen.get(m.round) ?? Infinity, ts(m)))
    return [...seen].sort((a, b) => a[1] - b[1]).map(([r]) => r)
  }, [ms])
  useEffect(() => {
    if (!rounds.length) return
    const now = Date.now()
    const upcoming = rounds.find((r) => ms.some((m) => m.round === r && m.status !== 'finished' && ts(m) >= now - DAY))
    setRound((cur) => (cur && rounds.includes(cur) ? cur : upcoming ?? rounds[rounds.length - 1]))
  }, [rounds, ms])
  const shown = (rounds.length ? ms.filter((m) => m.round === round) : [...ms].sort((a, b) => ts(a) - ts(b))).sort((a, b) => ts(a) - ts(b))
  const [view, setView] = useState<'rounds' | 'calendar'>('rounds')
  return (
    <div>
      <SourceLine load={load} retry={retry} />
      <Waiting load={load} retry={retry} what="fixtures" />
      <div className="fb-seg" role="group" aria-label="How to list fixtures">
        <button type="button" className={view === 'rounds' ? 'is-on' : ''} onClick={() => setView('rounds')}>
          By round
        </button>
        <button type="button" className={view === 'calendar' ? 'is-on' : ''} onClick={() => setView('calendar')}>
          Calendar
        </button>
      </div>
      {view === 'calendar' && load.state === 'ready' && <CalendarView matches={ms} onOpen={onOpen} selected={selected} />}
      {view === 'rounds' && rounds.length > 0 && (
        <label className="fb-inline">
          Round
          <select value={round} onChange={(e) => setRound(e.target.value)}>
            {rounds.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      )}
      {view === 'rounds' && load.state === 'ready' && (shown.length === 0 ? <p className="fb-note">No fixtures were returned for this competition and season.</p> : <ul className="fb-list">{shown.map((m) => <MatchRow key={m.key} m={m} onOpen={onOpen} selected={selected === m.key} />)}</ul>)}
    </div>
  )
}

export function TablePanel({ pick }: { pick: Pick }): React.JSX.Element {
  const [mode, setMode] = useState<'official' | 'calculated'>('official')
  const supported = pick.league.capabilities.table
  const [official, retryO] = useFb<FbStandingRow[]>(supported ? () => window.api.footballTable(pick.league.id, pick.season) : null, [pick.league.id, pick.season])
  const [season, retryS] = useSeasonMatches(pick)
  const rows: FbStandingRow[] | null = mode === 'official' ? (official.state === 'ready' ? official.answer.data : null) : season.state === 'ready' ? computeTable(season.answer.data) : null
  const load = mode === 'official' ? official : season
  if (!supported) return <p className="fb-note">{pick.league.name} is a knockout competition: it has no league table. Its fixtures and results are under Fixtures.</p>
  return (
    <div>
      <div className="fb-seg" role="group" aria-label="Which table">
        <button type="button" className={mode === 'official' ? 'is-on' : ''} onClick={() => setMode('official')}>
          Provider’s table
        </button>
        <button type="button" className={mode === 'calculated' ? 'is-on' : ''} onClick={() => setMode('calculated')}>
          Calculated from results
        </button>
      </div>
      <SourceLine load={load} retry={mode === 'official' ? retryO : retryS} />
      <Waiting load={load} retry={mode === 'official' ? retryO : retryS} what="the table" />
      {mode === 'calculated' && season.state === 'ready' && (
        <p className="fb-note">
          Built here from {season.answer.data.filter((m) => m.status === 'finished').length} finished matches: points, then goal difference, then goals scored. Head-to-head and other tie-breaks are not applied, and the fixture list the provider returned may be partial.
        </p>
      )}
      {rows && (
        <table className="fb-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Team</th>
              <th className="num">P</th>
              <th className="num">W</th>
              <th className="num">D</th>
              <th className="num">L</th>
              <th className="num">GF</th>
              <th className="num">GA</th>
              <th className="num">GD</th>
              <th className="num">Pts</th>
              <th>Form</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.team.id} title={r.note ?? undefined}>
                <td>{r.position ?? '–'}</td>
                <td>
                  <Crest url={r.team.badge} name={r.team.name} /> {r.team.name}
                </td>
                <td className="num">{r.played}</td>
                <td className="num">{r.won}</td>
                <td className="num">{r.drawn}</td>
                <td className="num">{r.lost}</td>
                <td className="num">{r.goalsFor}</td>
                <td className="num">{r.goalsAgainst}</td>
                <td className="num">{r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference}</td>
                <td className="num">
                  <b>{r.points}</b>
                </td>
                <td>{r.form ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ---- teams and analysis ----------------------------------------------------------------------------------------------------

const pct = (n: number, d: number): string => (d ? `${Math.round((n / d) * 100)}%` : '–')
const rate = (v: number | null): string => (v === null ? '–' : v.toFixed(2))

export function TeamsPanel({ pick, onOpen }: { pick: Pick; onOpen: (key: string) => void }): React.JSX.Element {
  const [load, retry] = useSeasonMatches(pick)
  const [teamId, setTeamId] = useState('')
  const [otherId, setOtherId] = useState('')
  const follows = useFollows()
  const ms = load.state === 'ready' ? load.answer.data : []
  const teams = useMemo(() => {
    const t = new Map<string, string>()
    for (const m of ms) {
      t.set(m.home.id, m.home.name)
      t.set(m.away.id, m.away.name)
    }
    return [...t].sort((a, b) => a[1].localeCompare(b[1]))
  }, [ms])
  const [formWindow, setFormWindow] = useState(5)
  const [earlier, setEarlier] = useState<FbMatch[]>([])
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const results = teamId ? teamResults(teamId, ms) : []
  const home = split(results.filter((r) => r.venue === 'home'))
  const away = split(results.filter((r) => r.venue === 'away'))
  const all = split(results)
  const h2h = teamId && otherId && otherId !== teamId ? headToHead(teamId, otherId, [...ms, ...earlier]) : null
  const loadEarlier = async (): Promise<void> => {
    setLoadingEarlier(true)
    const got: FbMatch[] = []
    for (let back = 1; back <= 3; back++) {
      const y = Number(pick.season) - back
      if (y < pick.league.firstSeason) break
      try {
        const a = (await window.api.footballSeason(pick.league.id, String(y))) as { ok: boolean; data?: FbMatch[] }
        if (a.ok && a.data) got.push(...a.data)
      } catch {
        // that season could not be loaded; the others still count
      }
    }
    setEarlier(got)
    setLoadingEarlier(false)
  }
  const name = (id: string): string => teams.find((t) => t[0] === id)?.[1] ?? id
  return (
    <div>
      <SourceLine load={load} retry={retry} />
      <Waiting load={load} retry={retry} what="the season" />
      {load.state === 'ready' && (
        <>
          <div className="fb-sourcebar">
            <label className="fb-inline">
              Team
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">Choose a team…</option>
                {teams.map(([id, n]) => (
                  <option key={id} value={id}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {teamId && (
              <button type="button" className="fb-btn" onClick={() => follows.toggleTeam(teamId, name(teamId))}>
                {follows.teams.includes(teamId) ? 'Unfollow' : 'Follow'}
              </button>
            )}
            <label className="fb-inline">
              Against
              <select value={otherId} onChange={(e) => setOtherId(e.target.value)}>
                <option value="">Head to head…</option>
                {teams.filter((t) => t[0] !== teamId).map(([id, n]) => (
                  <option key={id} value={id}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!teamId ? (
            <p className="fb-note">Choose a team to see its form, home and away record and results in {pick.league.name} {seasonLabel(pick.league, pick.season)}.</p>
          ) : (
            <>
              <TeamCard teamId={teamId} />
              <label className="fb-inline">
                Form window
                <select value={formWindow} onChange={(e) => setFormWindow(Number(e.target.value))}>
                  <option value={5}>Last 5</option>
                  <option value={10}>Last 10</option>
                </select>
              </label>
              <div className="fb-form" aria-label="Recent form, newest first">
                {results.slice(0, formWindow).map((r) => (
                  <button key={r.match.key} type="button" className={`fb-pip is-${r.result}`} title={`${r.match.home.name} ${r.match.score.home}–${r.match.score.away} ${r.match.away.name}`} onClick={() => onOpen(r.match.key)}>
                    {r.result}
                  </button>
                ))}
                {results.length === 0 && <span className="fb-note">No finished matches in this sample.</span>}
              </div>
              <table className="fb-table">
                <thead>
                  <tr>
                    <th>Record</th>
                    <th className="num">P</th>
                    <th className="num">W</th>
                    <th className="num">D</th>
                    <th className="num">L</th>
                    <th className="num">GF</th>
                    <th className="num">GA</th>
                    <th className="num">Pts/match</th>
                    <th className="num">GF/match</th>
                    <th className="num">GA/match</th>
                    <th className="num">Clean sheets</th>
                  </tr>
                </thead>
                <tbody>
                  {([['All', all], ['Home', home], ['Away', away]] as const).map(([label, s]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td className="num">{s.played}</td>
                      <td className="num">{s.won}</td>
                      <td className="num">{s.drawn}</td>
                      <td className="num">{s.lost}</td>
                      <td className="num">{s.goalsFor}</td>
                      <td className="num">{s.goalsAgainst}</td>
                      <td className="num">{rate(s.pointsPerMatch)}</td>
                      <td className="num">{rate(s.goalsForPerMatch)}</td>
                      <td className="num">{rate(s.goalsAgainstPerMatch)}</td>
                      <td className="num">
                        {s.cleanSheets} ({pct(s.cleanSheets, s.played)})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {results.length >= 6 && <Trend results={results} />}
              <SeasonHistory pick={pick} teamId={teamId} />
              <p className="fb-note">Sample: {all.played} finished matches in this season’s fixture list. Per-match rates need at least one match, so an empty sample shows “–”, not 0.</p>
              {h2h && (
                <section>
                  <h3 className="fb-h">
                    {name(teamId)} v {name(otherId)} · this season’s list
                  </h3>
                  <button type="button" className="fb-btn" onClick={() => void loadEarlier()} disabled={loadingEarlier || earlier.length > 0}>
                    {loadingEarlier ? 'Loading earlier seasons…' : earlier.length > 0 ? 'Earlier seasons included' : 'Include the previous three seasons'}
                  </button>
                  {h2h.meetings.length === 0 ? (
                    <p className="fb-note">They have not met in this fixture list.</p>
                  ) : (
                    <>
                      <p className="fb-note">
                        {name(teamId)} {h2h.aWins} · draws {h2h.draws} · {name(otherId)} {h2h.bWins} · goals {h2h.aGoals}–{h2h.bGoals} in {h2h.meetings.length} meetings
                      </p>
                      <ul className="fb-list">{h2h.meetings.map((m) => <MatchRow key={m.key} m={m} onOpen={onOpen} />)}</ul>
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

export function AnalyticsPanel({ pick, onOpen }: { pick: Pick; onOpen: (key: string) => void }): React.JSX.Element {
  const [load, retry] = useSeasonMatches(pick)
  const [who, setWho] = useState<string | null>(null)
  const ms = load.state === 'ready' ? load.answer.data : []
  const timing = useMemo(() => goalTiming(ms), [ms])
  const dist = useMemo(() => resultDistribution(ms), [ms])
  const scorers = useMemo(() => topScorers(ms), [ms])
  const evalr = useMemo(() => evaluateModel(ms), [ms])
  const upcoming = useMemo(() => ms.filter((m) => m.status === 'scheduled').sort((a, b) => ts(a) - ts(b)).slice(0, 9), [ms])
  const max = Math.max(1, ...timing.buckets.map((b) => b.goals))
  return (
    <div>
      <SourceLine load={load} retry={retry} />
      <Waiting load={load} retry={retry} what="the season" />
      {load.state === 'ready' && (
        <>
          <h3 className="fb-h">Results</h3>
          {dist.matches === 0 ? (
            <p className="fb-note">No finished matches yet in this list.</p>
          ) : (
            <p className="fb-note">
              {dist.matches} finished matches: home wins {dist.homeWins} ({pct(dist.homeWins, dist.matches)}) · draws {dist.draws} ({pct(dist.draws, dist.matches)}) · away wins {dist.awayWins} ({pct(dist.awayWins, dist.matches)}) · {rate(dist.goalsPerMatch)} goals per match.
              Common scorelines: {dist.scorelines.map((s) => `${s.score} ×${s.count}`).join(', ')}.
            </p>
          )}
          <Facts ms={ms} />
          <h3 className="fb-h">When goals are scored</h3>
          {!pick.league.capabilities.goalEvents ? (
            <p className="fb-note">{pick.league.name} comes from a provider that supplies scores but no goal list, so goal timing and top scorers are not available here. Choose a German competition for them.</p>
          ) : (
            <>
              <div className="fb-bars" role="img" aria-label={`Goals by minute band: ${timing.buckets.map((b) => `${b.label} ${b.goals}`).join(', ')}`}>
                {timing.buckets.map((b) => (
                  <div key={b.label} className="fb-col">
                    <span style={{ height: `${(b.goals / max) * 100}%` }} />
                    <b>{b.goals}</b>
                    <small>{b.label}</small>
                  </div>
                ))}
              </div>
              <p className="fb-note">
                From {timing.matchesWithEvents} of {timing.matches} finished matches that list goals{timing.unplaced ? `; ${timing.unplaced} goals have no minute and are left out` : ''}. “90+” covers added time and extra time together.
              </p>
              <h3 className="fb-h">Top scorers</h3>
              <table className="fb-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Team</th>
                    <th className="num">Goals</th>
                    <th className="num">Penalties</th>
                  </tr>
                </thead>
                <tbody>
                  {scorers.scorers.slice(0, 15).map((s) => (
                    <tr key={`${s.player}|${s.team}`} className={who === `${s.player}|${s.team}` ? 'is-on' : ''}>
                      <td>
                        <button type="button" className="fb-linkbtn" onClick={() => setWho(who === `${s.player}|${s.team}` ? null : `${s.player}|${s.team}`)}>
                          {s.player}
                        </button>
                      </td>
                      <td>{s.team}</td>
                      <td className="num">{s.goals}</td>
                      <td className="num">{s.penalties}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {who && (
                <section className="fb-alerts" aria-label="Goals by this player">
                  <h4 className="fb-h">
                    {who.split('|')[0]} · {who.split('|')[1]}
                  </h4>
                  <ul className="fb-list">
                    {ms
                      .filter((m) => m.events.some((e) => !e.revoked && e.kind !== 'own-goal' && e.player === who.split('|')[0] && (e.side === 'home' ? m.home.name : m.away.name) === who.split('|')[1]))
                      .sort((a, b) => ts(a) - ts(b))
                      .map((m) => (
                        <li key={m.key}>
                          <button type="button" className="fb-linkbtn" onClick={() => onOpen(m.key)}>
                            {m.home.name} {m.score.home}–{m.score.away} {m.away.name} ·{' '}
                            {m.events
                              .filter((e) => !e.revoked && e.kind !== 'own-goal' && e.player === who.split('|')[0])
                              .map((e) => `${e.minute ?? '?'}′${e.kind === 'penalty-goal' ? ' (pen.)' : ''}`)
                              .join(', ')}
                          </button>
                        </li>
                      ))}
                  </ul>
                  <p className="fb-note">Only what these goal lists show: no minutes played, shots or assists exist in this data.</p>
                </section>
              )}
              <p className="fb-note">Counted from the goal lists of {scorers.matchesCounted} matches; own goals are not credited to the scorer. No minutes-played data exists in these feeds, so there are no per-90 figures.</p>
            </>
          )}
          <h3 className="fb-h">An outcome model (experimental)</h3>
          {evalr === null ? (
            <p className="fb-note">Not enough finished matches yet to test a model fairly, so no probabilities are shown.</p>
          ) : (
            <>
              <p className="fb-note">
                Independent-Poisson goals fitted on earlier matches only, tested match by match through this season ({evalr.evaluated} predictions). Brier score {evalr.modelBrier.toFixed(3)} against {evalr.baselineBrier.toFixed(3)} for “always use the season’s home/draw/away rates” (lower is better).{' '}
                {evalr.beatsBaseline ? 'It beat that baseline here, which is not proof it will next time.' : 'It did not beat that baseline, so its probabilities are not shown.'}
              </p>
              {evalr.beatsBaseline && (
                <table className="fb-table">
                  <thead>
                    <tr>
                      <th>Match</th>
                      <th className="num">Home</th>
                      <th className="num">Draw</th>
                      <th className="num">Away</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcoming.map((m) => {
                      const prior = ms.filter((x) => x.status === 'finished' && ts(x) < ts(m))
                      const p = poissonOutcome(prior, m.home.id, m.away.id)
                      return (
                        <tr key={m.key}>
                          <td>
                            {m.home.name} – {m.away.name}
                          </td>
                          {p ? (
                            <>
                              <td className="num">{Math.round(p.home * 100)}%</td>
                              <td className="num">{Math.round(p.draw * 100)}%</td>
                              <td className="num">{Math.round(p.away * 100)}%</td>
                            </>
                          ) : (
                            <td colSpan={3}>Not enough history for these teams</td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

// ---- one match, and sources ------------------------------------------------------------------------------------------------

const KIND_WORD: Record<string, string> = { goal: 'Goal', card: 'Card', substitution: 'Substitution', var: 'VAR', other: 'Event' }

/** Lineup, timeline and statistics. The public key returns only the first few of each, and the screen says so. */
function MatchExtras({ matchKey }: { matchKey: string }): React.JSX.Element | null {
  const supported = matchKey.startsWith('thesportsdb:')
  const [load, retry] = useFb<FbMatchExtras>(supported ? () => window.api.footballExtras(matchKey) : null, [matchKey])
  if (!supported) return <p className="fb-note">This provider gives the score and the goals only: no lineup, timeline or statistics.</p>
  if (load.state !== 'ready') return <Waiting load={load} retry={retry} what="lineup and statistics" />
  const { lineup, timeline, stats, partial } = load.answer.data
  if (!lineup.length && !timeline.length && !stats.length) return <p className="fb-note">The provider has no lineup, timeline or statistics for this match.</p>
  const side = (k: 'home' | 'away'): typeof lineup => lineup.filter((p) => p.side === k)
  return (
    <section aria-label="Lineup, timeline and statistics">
      {partial && <p className="fb-note fb-warn">Partial: the provider’s public key returns only the first few entries of each list.</p>}
      {timeline.length > 0 && (
        <>
          <h4 className="fb-h">Timeline</h4>
          <ol className="fb-goals">
            {timeline.map((t) => (
              <li key={t.id} className={t.side === 'away' ? 'is-away' : ''}>
                <b>{t.minute === null ? '?' : `${t.minute}′`}</b> {KIND_WORD[t.kind]} · {t.player ?? 'Unknown'}
                {t.kind === 'substitution' && t.other ? ` (off: ${t.other})` : t.other ? ` (assist: ${t.other})` : ''}
                {t.detail && t.detail !== t.player ? ` · ${t.detail}` : ''}
              </li>
            ))}
          </ol>
        </>
      )}
      {stats.length > 0 && (
        <>
          <h4 className="fb-h">Statistics</h4>
          <ul className="fb-stats">
            {stats.map((st) => {
              const share = statShare(st)
              return (
                <li key={st.name}>
                  <span>{st.home ?? '–'}</span>
                  <span className="fb-stat-name">
                    {st.name}
                    {share ? (
                      <i className="fb-stat-bar" aria-hidden="true">
                        <b style={{ width: `${share.home * 100}%` }} />
                      </i>
                    ) : null}
                  </span>
                  <span>{st.away ?? '–'}</span>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {lineup.length > 0 && (
        <>
          <h4 className="fb-h">Lineup (as returned)</h4>
          <div className="fb-lineup">
            {(['home', 'away'] as const).map((k) => (
              <div key={k}>
                <small>{side(k)[0]?.team ?? (k === 'home' ? 'Home' : 'Away')}</small>
                <ul>
                  {side(k).map((p) => (
                    <li key={`${k}-${p.name}`}>
                      {p.number ?? '–'} · {p.name}
                      <small>
                        {p.position ?? ''}
                        {p.substitute ? ' · substitute' : ''}
                      </small>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <LineupPitch players={lineup} />
        </>
      )}
    </section>
  )
}

function TeamCard({ teamId }: { teamId: string }): React.JSX.Element | null {
  const [load, retry] = useFb<FbTeamProfile>(teamId.startsWith('thesportsdb:') ? () => window.api.footballTeam(teamId) : null, [teamId])
  if (!teamId.startsWith('thesportsdb:')) return <p className="fb-note">Team profiles come from TheSportsDB; this team is from OpenLigaDB, which has only fixtures, results and goals.</p>
  if (load.state !== 'ready') return <Waiting load={load} retry={retry} what="the team profile" />
  const t = load.answer.data
  return (
    <section className="fb-alerts" aria-label="Team profile">
      <h3 className="fb-h">
        <Crest url={t.badge} name={t.name} /> {t.name}
      </h3>
      <p className="fb-note">
        {[t.league, t.country, t.stadium ? `${t.stadium}${t.capacity ? ` (${t.capacity.toLocaleString()})` : ''}` : null, t.formed ? `founded ${t.formed}` : null].filter(Boolean).join(' · ')}
      </p>
      {t.description && <p className="fb-note">{t.description}…</p>}
      {t.squad.length > 0 && (
        <>
          <h4 className="fb-h">Squad (as returned{t.squadPartial ? ': the first ten only' : ''})</h4>
          <table className="fb-table">
            <tbody>
              {t.squad.map((p) => (
                <tr key={p.name}>
                  <td>{p.number ?? '–'}</td>
                  <td>{p.name}</td>
                  <td>{p.position ?? '–'}</td>
                  <td>{p.nationality ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <SourceLine load={load} retry={retry} />
    </section>
  )
}

export function MatchDetail({ matchKey, onClose }: { matchKey: string; onClose: () => void }): React.JSX.Element {
  const [load, retry] = useFb<FbMatch | null>(() => window.api.footballMatch(matchKey), [matchKey], 30_000)
  const follows = useFollows()
  const looked = load.state === 'ready' ? load.answer.data : null
  const seenRow = LAST_SEEN.get(matchKey)
  // The lookup says a match is under way but not which minute; the live list did. Use that, and only when it agrees.
  const m = looked && seenRow && looked.minute === null && isLive(looked.status) && seenRow.minute !== null && isLive(seenRow.status) ? { ...looked, minute: seenRow.minute, status: seenRow.status } : looked
  const events = m ? normalizeEvents(m.events) : []
  const check = m ? reconcileScore(m) : null
  const reduce = useReducedMotion(follows.data.ui.reduceMotion)
  const tz = follows.data.ui.timeZone
  useEffect(() => {
    if (m) follows.viewed(m.key, `${m.home.name} – ${m.away.name}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m?.key])
  return (
    <aside className="fb-detail" aria-label="Match">
      <button type="button" className="fb-btn" onClick={onClose}>
        Close
      </button>
      <Waiting load={load} retry={retry} what="this match" />
      {m && (
        <>
          <h3 className="fb-h">
            {m.home.name} {m.score.home ?? '–'} : {m.score.away ?? '–'} {m.away.name}
          </h3>
          <p className="fb-note">
            {clockLabel(m, Date.now(), tz)} · {m.competition.name}
            {m.round ? ` · ${m.round}` : ''} {m.venue ? `· ${m.venue}` : ''} <Fresh match={m} load={load} />
          </p>
          <p className="fb-note">{m.kickoff ? `Kick-off ${new Date(m.kickoff).toLocaleString([], { timeZone: tz ?? undefined })}` : 'Kick-off time not given'}{m.sourceUpdatedAt ? ` · provider updated ${new Date(m.sourceUpdatedAt).toLocaleString()}` : ''}</p>
          <p className="fb-note">{narrative(m)}</p>
          {m.halfTime && <p className="fb-note">Half-time {m.halfTime.home}–{m.halfTime.away}</p>}
          <EventStrip m={m} />
          <Replay m={m} reduceMotion={reduce} />
          <button type="button" className="fb-btn" onClick={() => follows.togglePin(m.key, `${m.home.name} – ${m.away.name}`)}>
            {follows.pins.includes(m.key) ? 'Unpin' : 'Pin this match'}
          </button>
          {m.status === 'scheduled' && m.kickoff && (
            <label className="fb-inline">
              Remind me
              <select
                value={follows.hasReminder(m.key) ?? ''}
                onChange={(e) => follows.setReminder(m.key, `${m.home.name} – ${m.away.name}`, m.kickoff as string, e.target.value === '' ? null : Number(e.target.value))}
              >
                <option value="">No reminder</option>
                {[5, 15, 30, 60].map((n) => (
                  <option key={n} value={n}>
                    {n} minutes before
                  </option>
                ))}
              </select>
            </label>
          )}
          <h4 className="fb-h">Goals</h4>
          {!m.eventsAvailable ? (
            <p className="fb-note">This provider gives the score without a goal list, so who scored and when is not available.</p>
          ) : events.length === 0 ? (
            <p className="fb-note">{m.status === 'scheduled' ? 'Not started.' : 'No goals are listed.'}</p>
          ) : (
            <ol className="fb-goals">
              {events.map((e) => (
                <li key={e.id} className={e.side === 'away' ? 'is-away' : ''}>
                  <b>{e.minute === null ? '?' : `${e.minute}′`}</b> {e.player ?? 'Unknown scorer'}
                  {e.kind === 'penalty-goal' ? ' (pen.)' : e.kind === 'own-goal' ? ' (own goal)' : ''}
                  {e.scoreAfter ? ` · ${e.scoreAfter.home}–${e.scoreAfter.away}` : ''}
                  {e.revoked ? ' · withdrawn' : ''}
                </li>
              ))}
            </ol>
          )}
          <MatchExtras matchKey={m.key} />
          {check && check.state !== 'not-applicable' && <p className={`fb-note${check.state === 'agrees' ? '' : ' fb-warn'}`}>{check.detail}</p>}
          <SourceLine load={load} retry={retry} />
        </>
      )}
    </aside>
  )
}

export function SourcesPanel(): React.JSX.Element {
  const [load, retry] = useFb<{ provider: string; base: string; requests: number; failures: number; lastOkAt: string | null; lastError: string | null; rateLimitedUntil: string | null; cached: number }[]>(() => window.api.footballStatus(), [], 5000)
  return (
    <div>
      <p className="fb-note">
        Football uses two open, keyless providers. <b>OpenLigaDB</b> is community-run and open: fixtures, tables and goal lists for German competitions, but no live flag, so “live” there is inferred and labelled. <b>TheSportsDB</b>, with its public test key, reports live status and
        minutes and has fixtures and tables for many leagues but no goal list; its free tier is for light use and can cap a season’s fixture list. Neither is an official feed, and neither is promised to stay free.
      </p>
      <Waiting load={load} retry={retry} what="provider status" />
      {load.state === 'ready' && (
        <table className="fb-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th className="num">Requests</th>
              <th className="num">Failures</th>
              <th>Last success</th>
              <th>Last problem</th>
              <th className="num">Cached</th>
            </tr>
          </thead>
          <tbody>
            {load.answer.data.map((s) => (
              <tr key={s.provider}>
                <td>
                  {s.provider}
                  <small>{s.base}</small>
                </td>
                <td className="num">{s.requests}</td>
                <td className="num">{s.failures}</td>
                <td>{s.lastOkAt ? new Date(s.lastOkAt).toLocaleTimeString() : '–'}</td>
                <td>{s.rateLimitedUntil ? `Rate-limited until ${new Date(s.rateLimitedUntil).toLocaleTimeString()}` : s.lastError ?? '–'}</td>
                <td className="num">{s.cached}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3 className="fb-h">What each competition really supplies</h3>
      <table className="fb-table">
        <thead>
          <tr>
            <th>Competition</th>
            <th>Provider</th>
            <th>Fixtures</th>
            <th>Table</th>
            <th>Live status</th>
            <th>Goal list</th>
          </tr>
        </thead>
        <tbody>
          {LEAGUES.map((l) => (
            <tr key={l.id} title={l.caveat ?? undefined}>
              <td>
                {l.name}
                <small>{l.country}</small>
              </td>
              <td>{l.provider}</td>
              <td>{l.capabilities.fixtures ? 'Yes' : 'No'}</td>
              <td>{l.capabilities.table ? 'Yes' : 'No'}</td>
              <td>{l.capabilities.liveScore ? 'Reported' : 'Inferred'}</td>
              <td>{l.capabilities.goalEvents ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fb-note">Not available from any provider here, so not shown anywhere: lineups, formations, shot maps, expected goals, player tracking, commentary, injuries.</p>
    </div>
  )
}

export { leagueById }

// ---- more views -------------------------------------------------------------------------------------------------------------

/** A month of fixtures by the viewer's own day; a day opens its matches. */
function CalendarView({ matches, onOpen, selected }: { matches: FbMatch[]; onOpen: (key: string) => void; selected: string | null }): React.JSX.Element {
  const follows = useFollows()
  const tz = follows.data.ui.timeZone ?? undefined
  const days = useMemo(() => byLocalDay(matches, tz), [matches, tz])
  const keys = [...days.keys()].sort()
  const first = keys.find((k) => k >= new Date().toISOString().slice(0, 10)) ?? keys[keys.length - 1]
  const [month, setMonth] = useState((first ?? new Date().toISOString().slice(0, 10)).slice(0, 7))
  const [day, setDay] = useState<string | null>(null)
  const [y, mo] = month.split('-').map(Number)
  const lead = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7
  const length = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  const shift = (d: number): void => {
    const t = new Date(Date.UTC(y, mo - 1 + d, 1))
    setMonth(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`)
    setDay(null)
  }
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)]
  const picked = day ? (days.get(day) ?? []) : []
  return (
    <div>
      <div className="fb-sourcebar">
        <button type="button" className="fb-btn" onClick={() => shift(-1)} aria-label="Previous month">
          ←
        </button>
        <b>{new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString([], { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b>
        <button type="button" className="fb-btn" onClick={() => shift(1)} aria-label="Next month">
          →
        </button>
        <span className="fb-note">Days are the viewer’s own ({tz ?? 'this computer'}), not the provider’s UTC day.</span>
      </div>
      <div className="fb-cal" role="grid" aria-label="Fixtures by day">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <b key={d} className="fb-cal-h" role="columnheader">
            {d}
          </b>
        ))}
        {cells.map((c, i) =>
          c === null ? (
            <span key={`e${i}`} />
          ) : (
            <button key={c} type="button" role="gridcell" className={`fb-cal-d${day === c ? ' is-on' : ''}${days.has(c) ? ' has' : ''}`} onClick={() => setDay(c)} aria-label={`${c}: ${(days.get(c) ?? []).length} matches`}>
              {Number(c.slice(8))}
              {days.has(c) && <i>{(days.get(c) ?? []).length}</i>}
            </button>
          )
        )}
      </div>
      {day && (picked.length === 0 ? <p className="fb-note">No matches on {day}.</p> : <ul className="fb-list">{picked.map((m) => <MatchRow key={m.key} m={m} onOpen={onOpen} selected={selected === m.key} />)}</ul>)}
    </div>
  )
}

/** Points per match over a rolling window of the team's own results, oldest first. Drawn only from complete windows. */
function Trend({ results }: { results: ReturnType<typeof teamResults> }): React.JSX.Element | null {
  const chron = [...results].reverse()
  const w = Math.min(5, Math.max(3, Math.floor(chron.length / 2)))
  const pts = rollingPoints(chron, w)
  if (pts.length < 2) return null
  const X = (i: number): number => 8 + (i / (pts.length - 1)) * 184
  const Y = (v: number): number => 46 - (v / 3) * 40
  return (
    <figure>
      <svg viewBox="0 0 200 52" className="fb-strip" role="img" aria-label={`Points per match over a rolling ${w} matches: ${pts.map((p) => p.ppm.toFixed(1)).join(', ')}`}>
        <line x1={8} x2={192} y1={Y(1)} y2={Y(1)} stroke="rgba(255,255,255,.2)" strokeDasharray="2 2" />
        <polyline fill="none" stroke="#38e8ff" strokeWidth={1.4} points={pts.map((p, i) => `${X(i)},${Y(p.ppm)}`).join(' ')} />
        {pts.map((p, i) => (
          <circle key={p.n} cx={X(i)} cy={Y(p.ppm)} r={1.6} fill="#38e8ff">
            <title>{`After match ${p.n}: ${p.ppm.toFixed(2)} points per match over the last ${w}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="fb-note">Points per match over a rolling {w} matches (3 is the most, 1 is the dashed line). Only complete windows are drawn; small samples move a lot.</figcaption>
    </figure>
  )
}

/** The same team in earlier seasons' tables, one request per season, side by side. */
function SeasonHistory({ pick, teamId }: { pick: Pick; teamId: string }): React.JSX.Element | null {
  const [rows, setRows] = useState<{ season: string; position: number | null; points: number; played: number; gd: number }[] | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setRows(null), [teamId, pick.league.id])
  if (!pick.league.capabilities.table) return null
  const run = async (): Promise<void> => {
    setBusy(true)
    const out: NonNullable<typeof rows> = []
    for (let back = 0; back < 6; back++) {
      const y = Number(pick.season) - back
      if (y < pick.league.firstSeason) break
      try {
        const a = (await window.api.footballTable(pick.league.id, String(y))) as { ok: boolean; data?: FbStandingRow[] }
        const r = a.ok ? a.data?.find((x) => x.team.id === teamId) : undefined
        if (r) out.push({ season: String(y), position: r.position, points: r.points, played: r.played, gd: r.goalDifference })
      } catch {
        // a season that could not be loaded is simply absent
      }
    }
    setRows(out)
    setBusy(false)
  }
  return (
    <div>
      <button type="button" className="fb-btn" onClick={() => void run()} disabled={busy || rows !== null}>
        {busy ? 'Loading seasons…' : rows ? 'Seasons loaded' : 'Show the last six seasons'}
      </button>
      {rows && (
        <table className="fb-table">
          <thead>
            <tr>
              <th>Season</th>
              <th className="num">Position</th>
              <th className="num">Played</th>
              <th className="num">Points</th>
              <th className="num">GD</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5}>This team is not in those seasons’ tables (or they could not be loaded).</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.season}>
                <td>{seasonLabel(pick.league, r.season)}</td>
                <td className="num">{r.position ?? '–'}</td>
                <td className="num">{r.played}</td>
                <td className="num">{r.points}</td>
                <td className="num">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows && <p className="fb-note">A season’s points are not comparable when the league had a different number of matches; the played column says how many.</p>}
    </div>
  )
}

/** Plain statements counted from the season, each with what it was counted from, and how the tables are built. */
function Facts({ ms }: { ms: FbMatch[] }): React.JSX.Element {
  const items = useMemo(() => seasonInsights(ms), [ms])
  return (
    <section>
      <h3 className="fb-h">What the season shows</h3>
      {items.length === 0 ? (
        <p className="fb-note">Too few finished matches yet for a statement (it takes five).</p>
      ) : (
        <ul className="fb-reminders">
          {items.map((i) => (
            <li key={i.text}>
              {i.text} <small className="fb-note">Counted from {i.basis}.</small>
            </li>
          ))}
        </ul>
      )}
      <details className="fb-note">
        <summary>How these numbers are made</summary>
        <p>
          Everything here is counted from the matches this competition’s provider returned for the season, and only finished matches with a score count. Percentages divide by the matches counted, so an empty sample shows a dash, not 0. Goal minutes are the
          provider’s; goals with no minute are left out of the minute bands and counted aside. Statements describe what happened: they do not say why, and none of them is a forecast.
        </p>
      </details>
    </section>
  )
}
