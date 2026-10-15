import { ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { LEAGUES, currentSeason, seasonLabel } from '../../../../shared/football/leagues'
import { AnalyticsPanel, FixturesPanel, MatchDetail, NowPanel, SourcesPanel, TablePanel, TeamsPanel, type Pick } from './panels'
import { useFollows } from './shared'
import { Pitch, useReducedMotion } from './MatchViews'
import './football.css'

interface Props {
  onClose(): void
}

type Tab = 'now' | 'fixtures' | 'table' | 'teams' | 'analytics' | 'sources'
const TABS: { id: Tab; label: string; hint: string; needsLeague: boolean }[] = [
  { id: 'now', label: 'Now', hint: 'Live matches, what starts soon, what just finished', needsLeague: false },
  { id: 'fixtures', label: 'Fixtures', hint: 'A competition’s matches by round', needsLeague: true },
  { id: 'table', label: 'Table', hint: 'The standings, and one calculated from results', needsLeague: true },
  { id: 'teams', label: 'Teams', hint: 'Form, home and away record, and head to head', needsLeague: true },
  { id: 'analytics', label: 'Analytics', hint: 'Results, goal timing, top scorers and an experimental model', needsLeague: true },
  { id: 'sources', label: 'Sources', hint: 'Where the data comes from and what each competition supplies', needsLeague: false }
]

/**
 * Football inside Orbis Arena, full screen. Each tab asks the main process for its own data and says where it came from;
 * nothing is shown that a provider did not supply.
 */
export default function FootballView({ onClose }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('now')
  const [leagueId, setLeagueId] = useState(LEAGUES[0].id)
  const league = LEAGUES.find((l) => l.id === leagueId) ?? LEAGUES[0]
  const [season, setSeason] = useState(() => currentSeason(league, new Date()))
  const [open, setOpen] = useState<string | null>(null)
  const follows = useFollows()
  const reduce = useReducedMotion(follows.data.ui.reduceMotion)
  const [intro, setIntro] = useState(true)
  const restored = useRef(false)
  // Football opens where the person left it (once their saved choices have loaded).
  useEffect(() => {
    if (restored.current) return
    const u = follows.data.ui
    if (u.tab === 'now' && !u.league && !u.season) return
    restored.current = true
    if (u.tab && u.tab !== 'now') setTab(u.tab)
    if (u.league && LEAGUES.some((l) => l.id === u.league)) {
      setLeagueId(u.league)
      if (u.season) setPendingSeason(u.season)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follows.data.ui])
  useEffect(() => {
    if (!restored.current && tab === 'now') return
    const u = follows.data.ui
    if (u.tab !== tab || u.league !== leagueId || u.season !== season) follows.setUi({ tab: tab as 'now' | 'fixtures' | 'table' | 'teams' | 'analytics' | 'sources', league: leagueId, season })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, leagueId, season])

  const [pendingSeason, setPendingSeason] = useState<string | null>(null)
  useEffect(() => {
    setSeason(pendingSeason ?? currentSeason(league, new Date()))
    setPendingSeason(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (open) setOpen(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, open])

  const years = useMemo(() => {
    const now = Number(currentSeason(league, new Date()))
    return Array.from({ length: Math.max(1, now - league.firstSeason + 1) }, (_, i) => String(now - i))
  }, [league])
  const pick: Pick = { league, season }
  const needs = TABS.find((t) => t.id === tab)?.needsLeague ?? false

  return (
    <section className="fb-full" aria-label="Football">
      <header className="fb-bar">
        <button type="button" className="fb-back" onClick={onClose} title="Back to chat (Esc)" aria-label="Back to chat">
          <ArrowLeft size={16} />
        </button>
        <span className="fb-title">FOOTBALL</span>
        <span className="fb-crumb">Orbis Arena</span>
        <nav className="fb-tabs" aria-label="Football sections">
          {TABS.map((t) => (
            <button key={t.id} type="button" title={t.hint} className={`fb-tab${tab === t.id ? ' is-on' : ''}`} aria-current={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <span className="fb-pick">
          {follows.data.views.length > 0 && (
            <select
              value=""
              aria-label="Saved views"
              onChange={(e) => {
                const v = follows.data.views.find((x) => x.id === e.target.value)
                if (!v) return
                setTab(v.tab)
                setPendingSeason(v.season)
                if (v.league === leagueId) setSeason(v.season)
                else setLeagueId(v.league)
              }}
            >
              <option value="">Saved views…</option>
              {follows.data.views.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          )}
          {needs && (
            <button
              type="button"
              className="fb-btn"
              title="Save this competition, season and tab"
              onClick={() => follows.saveView({ name: `${league.name} ${seasonLabel(league, season)} · ${TABS.find((t) => t.id === tab)?.label ?? ''}`, tab: tab as 'fixtures' | 'table' | 'teams' | 'analytics', league: leagueId, season })}
            >
              Save view
            </button>
          )}
        </span>
        {needs && (
          <span className="fb-pick">
            <select value={leagueId} onChange={(e) => setLeagueId(e.target.value)} aria-label="Competition">
              {LEAGUES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.country})
                </option>
              ))}
            </select>
            <select value={season} onChange={(e) => setSeason(e.target.value)} aria-label="Season">
              {years.map((y) => (
                <option key={y} value={y}>
                  {seasonLabel(league, y)}
                </option>
              ))}
            </select>
          </span>
        )}
      </header>
      {intro && follows.data.ui.intro && (
        <div className="fb-intro" role="dialog" aria-label="Football opening">
          <div className="fb-intro-beams" aria-hidden="true" style={reduce ? { animation: 'none', opacity: 1 } : undefined} />
          <div className="fb-intro-card" style={reduce ? { animation: 'none' } : undefined}>
            <div style={{ width: 'min(520px, 70vw)' }} aria-hidden="true">
              <Pitch label="A football pitch" />
            </div>
            <h2>FOOTBALL</h2>
            <p className="fb-note">Live scores, fixtures and tables from open data, with what each source can and cannot supply.</p>
            <div className="fb-sourcebar">
              <button type="button" className="fb-btn" onClick={() => setIntro(false)} autoFocus>
                Enter
              </button>
              <button
                type="button"
                className="fb-btn"
                onClick={() => {
                  follows.setUi({ intro: false })
                  setIntro(false)
                }}
              >
                Skip and don’t show again
              </button>
            </div>
          </div>
        </div>
      )}
      <div className={`fb-body${open ? ' has-detail' : ''}`}>
        <div className="fb-main">
          {needs && league.caveat && <p className="fb-note">{league.caveat}</p>}
          {tab === 'now' && <NowPanel onOpen={setOpen} selected={open} />}
          {tab === 'fixtures' && <FixturesPanel pick={pick} onOpen={setOpen} selected={open} />}
          {tab === 'table' && <TablePanel pick={pick} />}
          {tab === 'teams' && <TeamsPanel pick={pick} onOpen={setOpen} />}
          {tab === 'analytics' && <AnalyticsPanel pick={pick} onOpen={setOpen} />}
          {tab === 'sources' && <SourcesPanel />}
        </div>
        {open && <MatchDetail matchKey={open} onClose={() => setOpen(null)} />}
      </div>
    </section>
  )
}
