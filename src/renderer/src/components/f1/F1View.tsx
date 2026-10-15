import { ArrowLeft } from 'lucide-react'
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import type { F1Race } from '../../../../shared/f1/types'
import { ResultsPanel, SeasonPanel, StandingsPanel, TimingPanel } from './ClassicPanels'
import { useF1 } from './shared'
import './f1.css'

interface Props {
  onClose(): void
}

const LivePanel = lazy(() => import('./LivePanel'))
const TelemetryPanel = lazy(() => import('./TelemetryPanel'))
const StrategyPanel = lazy(() => import('./StrategyPanel'))
const RacePanel = lazy(() => import('./RacePanel'))
const DriversPanel = lazy(() => import('./DriversPanel'))
const ChampionshipPanel = lazy(() => import('./ChampionshipPanel'))
const SourcesPanel = lazy(() => import('./SourcesPanel'))
const ConstructorsPanel = lazy(() => import('./ExtraPanels').then((m) => ({ default: m.ConstructorsPanel })))
const QualifyingPanel = lazy(() => import('./ExtraPanels').then((m) => ({ default: m.QualifyingPanel })))
const CircuitsPanel = lazy(() => import('./ExtraPanels').then((m) => ({ default: m.CircuitsPanel })))
const RadioPanel = lazy(() => import('./ExtraPanels').then((m) => ({ default: m.RadioPanel })))
const HistoryPanel = lazy(() => import('./InsightPanels').then((m) => ({ default: m.HistoryPanel })))
const AlertsPanel = lazy(() => import('./ExtraPanels').then((m) => ({ default: m.AlertsPanel })))

type Tab = 'live' | 'telemetry' | 'strategy' | 'race' | 'drivers' | 'championship' | 'season' | 'standings' | 'results' | 'history' | 'qualifying' | 'teams' | 'circuits' | 'radio' | 'timing' | 'sources'
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'live', label: 'Live', hint: 'Live timing, and replay of finished sessions' },
  { id: 'telemetry', label: 'Telemetry', hint: 'Speed, throttle, brake, gear and delta for a lap' },
  { id: 'strategy', label: 'Strategy', hint: 'Tyres, pit stops, stint pace and a what-if' },
  { id: 'race', label: 'Race', hint: 'Position by lap, gaps, weather and race control' },
  { id: 'drivers', label: 'Drivers', hint: 'Profiles, results, teammate comparison and career' },
  { id: 'championship', label: 'Championship', hint: 'Points progression, what is still possible, and what-ifs' },
  { id: 'season', label: 'Season', hint: 'The calendar' },
  { id: 'standings', label: 'Standings', hint: 'Drivers and constructors' },
  { id: 'results', label: 'Results', hint: 'Race classifications' },
  { id: 'history', label: 'History', hint: 'Every champion, and what data exists for each era' },
  { id: 'qualifying', label: 'Qualifying', hint: 'Q1, Q2 and Q3 of any race' },
  { id: 'teams', label: 'Teams', hint: 'A constructor’s season, round by round' },
  { id: 'circuits', label: 'Circuits', hint: 'The fastest lap of every race run at a circuit' },
  { id: 'radio', label: 'Radio', hint: 'Team-radio clips of a session' },
  { id: 'timing', label: 'Timing', hint: 'Every lap and sector of a session' },
  { id: 'sources', label: 'Sources', hint: 'Where the data comes from and how it is doing' }
]

/**
 * F1 inside Orbis Arena, full screen. Each tab asks the main process for its own data and says where it came from;
 * nothing is shown that a provider did not supply.
 */
export default function F1View({ onClose }: Props): React.JSX.Element {
  const thisYear = new Date().getFullYear()
  const [tab, setTab] = useState<Tab>('live')
  const [season, setSeason] = useState<number>(thisYear)
  const years = useMemo(() => Array.from({ length: thisYear - 2017 }, (_, i) => thisYear - i), [thisYear])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const [calendar, reloadCalendar] = useF1<F1Race[]>(() => window.api.f1Schedule(season), [season])

  return (
    <section className="f1-full" aria-label="F1">
      <header className="f1-bar">
        <button type="button" className="f1-back" onClick={onClose} title="Back to chat (Esc)" aria-label="Back to chat">
          <ArrowLeft size={16} />
        </button>
        <span className="f1-title">F1</span>
        <span className="f1-crumb">Orbis Arena</span>
        <nav className="f1-tabs" aria-label="F1 sections">
          {TABS.map((t) => (
            <button key={t.id} type="button" title={t.hint} className={`f1-tab${tab === t.id ? ' is-on' : ''}`} aria-current={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <label className="f1-season">
          Season
          <select value={season} onChange={(e) => setSeason(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="f1-body">
        <Suspense fallback={<p className="f1-note">Loading…</p>}>
          {tab === 'live' && <LivePanel year={Math.max(2018, season)} />}
          {tab === 'telemetry' && <TelemetryPanel year={season} />}
          {tab === 'strategy' && <StrategyPanel year={season} />}
          {tab === 'race' && <RacePanel year={season} />}
          {tab === 'drivers' && <DriversPanel season={season} />}
          {tab === 'championship' && <ChampionshipPanel season={season} calendar={calendar} />}
          {tab === 'season' && (
            <>
              <AlertsPanel calendar={calendar} />
              <SeasonPanel calendar={calendar} retry={reloadCalendar} season={season} />
            </>
          )}
          {tab === 'history' && <HistoryPanel season={season} onSeason={setSeason} />}
          {tab === 'qualifying' && <QualifyingPanel season={season} calendar={calendar} />}
          {tab === 'teams' && <ConstructorsPanel season={season} />}
          {tab === 'circuits' && <CircuitsPanel calendar={calendar} />}
          {tab === 'radio' && <RadioPanel year={season} />}
          {tab === 'standings' && <StandingsPanel season={season} calendar={calendar} />}
          {tab === 'results' && <ResultsPanel season={season} calendar={calendar} />}
          {tab === 'timing' && <TimingPanel season={season} />}
          {tab === 'sources' && <SourcesPanel />}
        </Suspense>
      </div>
    </section>
  )
}
