import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Gamepad2, Pause, Play, RefreshCw, RotateCcw, Search, Settings2, Shuffle, Star, Trophy, Volume2, VolumeX, Wifi, WifiOff, X } from 'lucide-react'
import type { GameCategory, GameId, GameInfo, LoadFailureKind, OfflineGamesData, OfflineGamesPrefs, ScoreRecord } from '../../../shared/offlineGames'
import { beats, DEFAULT_PREFS, GAMES, gameInfo, gameOfTheDay, launchChoice, randomGame, recordScore, searchGames } from '../../../shared/offlineGames'
import type { GameInstance, GamePrefs, GameState } from '../games/engine'
import { createAudio, createInput } from '../games/engine'
import { GAME_LOADERS } from '../games'
import { useOfflineGames } from '../games/useOfflineGames'
import '../games/games.css'

const CATEGORIES: { id: GameCategory | 'all' | 'favorites'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'arcade', label: 'Arcade' },
  { id: 'puzzle', label: 'Puzzle' },
  { id: 'reaction', label: 'Reaction' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'classic', label: 'Classic' },
  { id: 'casual', label: 'Casual' },
  { id: 'typing', label: 'Typing' }
]

const formatScore = (game: GameInfo, value: number): string => (game.score === 'lower-ms' ? `${value} ms` : game.score === 'wpm' ? `${value} WPM` : value.toLocaleString())

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = (): void => setOnline(true)
    const off = (): void => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

interface Props {
  url: string
  reason: string
  kind: LoadFailureKind
  /** This tab is the one on screen; games pause when it isn't. */
  active: boolean
  retrying: boolean
  onRetry(): void
}

/**
 * The Orbis offline page, shown when a page can't load because of the network: what went wrong, a retry, and a library
 * of games to play while waiting. Each tab has its own; a game pauses when its tab is hidden.
 */
export default function OfflineGames({ url, reason, kind, active, retrying, onRetry }: Props): React.JSX.Element {
  const [data, update] = useOfflineGames()
  const prefs = data.prefs
  const online = useOnline()
  const [view, setView] = useState<'page' | 'ask' | 'library' | 'game'>(() => (prefs.behavior === 'auto-launch' ? 'game' : prefs.behavior === 'ask' ? 'ask' : 'page'))
  const [gameId, setGameId] = useState<GameId>(() => launchChoice(data, new Date()))
  const [continueSaved, setContinueSaved] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [playing, setPlaying] = useState(false)
  // The connection came back after being lost while this page was open.
  const wasOffline = useRef(!navigator.onLine)
  const [recovered, setRecovered] = useState(false)
  useEffect(() => {
    if (!online) {
      wasOffline.current = true
      setRecovered(false)
      return
    }
    if (!wasOffline.current) return
    wasOffline.current = false
    if (prefs.autoRetry && !playing) onRetry()
    else setRecovered(true)
  }, [online]) // eslint-disable-line react-hooks/exhaustive-deps

  const host = useMemo(() => {
    try {
      return new URL(url).host
    } catch {
      return url
    }
  }, [url])

  const open = (id: GameId, resume = false): void => {
    setGameId(id)
    setContinueSaved(resume)
    setView('game')
  }

  const setPref = <K extends keyof OfflineGamesPrefs>(key: K, value: OfflineGamesPrefs[K]): void => update((d) => ({ ...d, prefs: { ...d.prefs, [key]: value } }))

  const banner = recovered && (
    <div className="og-recovered" role="status">
      <Wifi size={15} />
      <span>You're back online.</span>
      <button type="button" className="og-btn primary" onClick={onRetry}>
        Reload page
      </button>
      <button type="button" className="og-icon-btn" aria-label="Dismiss" onClick={() => setRecovered(false)}>
        <X size={14} />
      </button>
    </div>
  )

  return (
    <div className="og" data-kind={kind}>
      {banner}
      {view === 'game' ? (
        <GameView
          key={`${gameId}-${continueSaved}`}
          gameId={gameId}
          data={data}
          update={update}
          active={active}
          resume={continueSaved}
          onPlaying={setPlaying}
          onExit={() => {
            setPlaying(false)
            setView('library')
          }}
          onRetry={onRetry}
          retrying={retrying}
          host={host}
        />
      ) : (
        <div className="og-page">
          <header className="og-head">
            <div className="og-status">
              <WifiOff size={30} />
              <div>
                <h2>{kind === 'no-internet' ? "You're offline" : "This page can't be reached"}</h2>
                <p>
                  {reason}
                  {host ? ` · ${host}` : ''}
                </p>
                <p className="og-muted">{online ? 'Your device reports a network connection; the site may be down or blocked.' : 'Check your Wi-Fi or network cable.'}</p>
              </div>
            </div>
            <div className="og-head-actions">
              <button type="button" className="og-btn primary" onClick={onRetry} disabled={retrying}>
                <RefreshCw size={14} className={retrying ? 'og-spin' : undefined} /> {retrying ? 'Trying…' : 'Try again'}
              </button>
              {view === 'page' || view === 'ask' ? (
                <button type="button" className="og-btn" onClick={() => setView('library')}>
                  <Gamepad2 size={14} /> Play a game
                </button>
              ) : (
                <button type="button" className="og-icon-btn" aria-label="Game settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((v) => !v)}>
                  <Settings2 size={16} />
                </button>
              )}
            </div>
          </header>
          {view === 'ask' && (
            <div className="og-ask">
              <span>Play a game while you wait?</span>
              <button type="button" className="og-btn primary" onClick={() => open(launchChoice(data, new Date()))}>
                Play {gameInfo(launchChoice(data, new Date())).name}
              </button>
              <button type="button" className="og-btn" onClick={() => setView('library')}>
                Choose a game
              </button>
              <button type="button" className="og-btn ghost" onClick={() => setView('page')}>
                No thanks
              </button>
            </div>
          )}
          {view === 'library' && settingsOpen && <GameSettings prefs={prefs} setPref={setPref} onReset={() => update((d) => ({ ...d, scores: {}, recent: [], saved: {} }))} />}
          {view === 'library' && <Library data={data} update={update} onOpen={open} />}
        </div>
      )}
    </div>
  )
}

function Library({ data, update, onOpen }: { data: OfflineGamesData; update: (fn: (d: OfflineGamesData) => OfflineGamesData) => void; onOpen(id: GameId, resume?: boolean): void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<GameCategory | 'all' | 'favorites'>('all')
  const games = searchGames(query, category, data.favorites)
  const daily = gameInfo(gameOfTheDay(new Date()))
  const toggleFavorite = (id: GameId): void => update((d) => ({ ...d, favorites: d.favorites.includes(id) ? d.favorites.filter((f) => f !== id) : [...d.favorites, id] }))

  return (
    <div className="og-library">
      <div className="og-featured">
        <button type="button" className="og-daily" onClick={() => onOpen(daily.id)}>
          <span className="og-daily-icon" aria-hidden>
            {daily.icon}
          </span>
          <span>
            <small>Game of the day</small>
            <b>{daily.name}</b>
            <span className="og-muted">{daily.description}</span>
          </span>
        </button>
        <button type="button" className="og-btn" onClick={() => onOpen(randomGame(undefined, data.recent[0]?.gameId))}>
          <Shuffle size={14} /> Random game
        </button>
      </div>

      {data.recent.length > 0 && (
        <div className="og-recent" aria-label="Recently played">
          <small>Recently played</small>
          <div className="og-recent-row">
            {data.recent.slice(0, 6).map((r) => {
              const g = gameInfo(r.gameId)
              return (
                <button key={r.gameId} type="button" className="og-chip" onClick={() => onOpen(r.gameId)}>
                  <span aria-hidden>{g.icon}</span> {g.name} <span className="og-muted">{formatScore(g, r.score)}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="og-filters">
        <label className="og-search">
          <Search size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search games" aria-label="Search games" />
        </label>
        <div className="og-cats" role="tablist" aria-label="Categories">
          {CATEGORIES.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={category === c.id} className={`og-chip${category === c.id ? ' on' : ''}`} onClick={() => setCategory(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="og-grid">
        {games.map((g) => {
          const score = data.scores[g.id]
          const saved = data.saved[g.id]
          const favorite = data.favorites.includes(g.id)
          return (
            <div key={g.id} className="og-card">
              <button type="button" className="og-card-main" onClick={() => onOpen(g.id)} aria-label={`Play ${g.name}`}>
                <span className="og-card-icon" aria-hidden>
                  {g.icon}
                </span>
                <b>{g.name}</b>
                <span className="og-muted">{g.description}</span>
                <span className="og-card-meta">
                  {score ? (
                    <>
                      <Trophy size={12} /> {formatScore(g, score.best)} · {score.plays} play{score.plays === 1 ? '' : 's'}
                    </>
                  ) : (
                    'Not played yet'
                  )}
                </span>
              </button>
              <div className="og-card-actions">
                {saved && (
                  <button type="button" className="og-btn small" onClick={() => onOpen(g.id, true)}>
                    Continue
                  </button>
                )}
                <button type="button" className={`og-icon-btn${favorite ? ' fav' : ''}`} aria-label={favorite ? `Remove ${g.name} from favorites` : `Add ${g.name} to favorites`} aria-pressed={favorite} onClick={() => toggleFavorite(g.id)}>
                  <Star size={15} fill={favorite ? 'currentColor' : 'none'} />
                </button>
              </div>
            </div>
          )
        })}
        {!games.length && <p className="og-muted">No games match.</p>}
      </div>
    </div>
  )
}

function GameSettings({ prefs, setPref, onReset }: { prefs: OfflineGamesPrefs; setPref: <K extends keyof OfflineGamesPrefs>(key: K, value: OfflineGamesPrefs[K]) => void; onReset(): void }): React.JSX.Element {
  const [confirmReset, setConfirmReset] = useState(false)
  return <OfflineGameSettingsFields prefs={prefs} setPref={setPref} extra={
    <div className="og-setting">
      <span>Scores and saved games</span>
      {confirmReset ? (
        <span className="og-inline">
          <button type="button" className="og-btn danger small" onClick={() => (onReset(), setConfirmReset(false))}>
            Erase them
          </button>
          <button type="button" className="og-btn small" onClick={() => setConfirmReset(false)}>
            Keep
          </button>
        </span>
      ) : (
        <button type="button" className="og-btn small" onClick={() => setConfirmReset(true)}>
          Reset…
        </button>
      )}
    </div>
  } />
}

/** The offline game preferences, used on the offline page and in Orbis settings. */
export function OfflineGameSettingsFields({ prefs, setPref, extra }: { prefs: OfflineGamesPrefs; setPref: <K extends keyof OfflineGamesPrefs>(key: K, value: OfflineGamesPrefs[K]) => void; extra?: React.ReactNode }): React.JSX.Element {
  const toggle = (key: 'sound' | 'music' | 'highContrast' | 'showScore' | 'showHighScore' | 'autoRetry', label: string) => (
    <label className="og-setting">
      <span>{label}</span>
      <input type="checkbox" checked={prefs[key]} onChange={(e) => setPref(key, e.target.checked)} />
    </label>
  )
  return (
    <div className="og-settings">
      <label className="og-setting">
        <span>When a page can't load</span>
        <select value={prefs.behavior} onChange={(e) => setPref('behavior', e.target.value as OfflineGamesPrefs['behavior'])}>
          <option value="error-page">Show the offline page</option>
          <option value="ask">Ask to play a game</option>
          <option value="auto-launch">Start a game</option>
        </select>
      </label>
      <label className="og-setting">
        <span>Game to start</span>
        <select value={prefs.launchGame} onChange={(e) => setPref('launchGame', e.target.value as OfflineGamesPrefs['launchGame'])}>
          <option value="daily">Game of the day</option>
          <option value="default">My default game</option>
          <option value="last">Last played</option>
          <option value="random">Random</option>
        </select>
      </label>
      <label className="og-setting">
        <span>Default game</span>
        <select value={prefs.defaultGame} onChange={(e) => setPref('defaultGame', e.target.value as GameId)}>
          {GAMES.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <label className="og-setting">
        <span>Difficulty</span>
        <select value={prefs.difficulty} onChange={(e) => setPref('difficulty', e.target.value as OfflineGamesPrefs['difficulty'])}>
          <option value="easy">Easy</option>
          <option value="normal">Normal</option>
          <option value="hard">Hard</option>
        </select>
      </label>
      <label className="og-setting">
        <span>Reduced motion</span>
        <select value={prefs.reducedMotion} onChange={(e) => setPref('reducedMotion', e.target.value as OfflineGamesPrefs['reducedMotion'])}>
          <option value="system">Follow the system</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </label>
      {toggle('sound', 'Sound effects')}
      {toggle('music', 'Background music')}
      {toggle('highContrast', 'High contrast')}
      {toggle('showScore', 'Show score while playing')}
      {toggle('showHighScore', 'Show high score while playing')}
      {toggle('autoRetry', 'Reload the page when the connection returns')}
      {extra}
    </div>
  )
}

interface GameViewProps {
  gameId: GameId
  data: OfflineGamesData
  update: (fn: (d: OfflineGamesData) => OfflineGamesData) => void
  active: boolean
  resume: boolean
  retrying: boolean
  host: string
  onPlaying(playing: boolean): void
  onExit(): void
  onRetry(): void
}

function GameView({ gameId, data, update, active, resume, retrying, host, onPlaying, onExit, onRetry }: GameViewProps): React.JSX.Element {
  const game = gameInfo(gameId)
  const systemReduced = usePrefersReducedMotion()
  const prefs = data.prefs
  const rootRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<GameInstance | null>(null)
  const audioRef = useRef<ReturnType<typeof createAudio> | null>(null)
  const [state, setState] = useState<GameState | null>(null)
  const [result, setResult] = useState<{ score: number; newBest: boolean; previousBest?: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const best = data.scores[gameId]?.best

  const gamePrefs: GamePrefs = {
    reducedMotion: prefs.reducedMotion === 'on' || (prefs.reducedMotion === 'system' && systemReduced),
    highContrast: prefs.highContrast,
    sound: prefs.sound,
    music: prefs.music,
    difficulty: prefs.difficulty
  }

  useEffect(() => {
    const root = rootRef.current
    const surface = surfaceRef.current
    if (!root || !surface) return
    let cancelled = false
    let observer: ResizeObserver | null = null
    let input: ReturnType<typeof createInput> | null = null
    setLoading(true)
    GAME_LOADERS[gameId]()
      .then(({ default: mod }) => {
        if (cancelled) return
        surface.replaceChildren()
        const canvas = mod.surface === 'canvas' ? document.createElement('canvas') : null
        if (canvas) {
          canvas.className = 'og-canvas'
          canvas.setAttribute('role', 'img')
          canvas.setAttribute('aria-label', `${game.name} game`)
          surface.appendChild(canvas)
        }
        input = createInput(root, surface)
        const audio = createAudio(gamePrefs.sound, gamePrefs.music)
        audioRef.current = audio
        const scoreBefore = data.scores[gameId]?.best
        const instance = mod.create({
          gameId,
          root,
          canvas,
          prefs: gamePrefs,
          best: scoreBefore,
          input,
          audio,
          emit: (s) => {
            setState(s)
            onPlaying(s.status === 'running')
          },
          over: ({ score, extra }: { score: number; extra?: ScoreRecord['extra'] }) => {
            let previous: number | undefined
            let newBest = false
            update((d) => {
              previous = d.scores[gameId]?.best
              newBest = beats(gameId, score, previous)
              return recordScore(d, gameId, score, extra).data
            })
            setResult({ score, newBest, previousBest: previous })
            onPlaying(false)
          },
          save: game.continuable ? (saved) => update((d) => {
            const next = { ...d.saved }
            if (saved === null || saved === undefined) delete next[gameId]
            else next[gameId] = { state: saved, savedAt: Date.now() }
            return { ...d, saved: next }
          }) : undefined
        })
        instanceRef.current = instance
        const fit = (): void => {
          const rect = surface.getBoundingClientRect()
          if (rect.width > 10 && rect.height > 10) instance.resize(Math.floor(rect.width), Math.floor(rect.height))
        }
        fit()
        instance.start()
        if (resume && data.saved[gameId] && instance.restore && !instance.restore(data.saved[gameId]!.state)) {
          setError("That saved game couldn't be loaded, so a new one started.")
        }
        observer = new ResizeObserver(fit)
        observer.observe(surface)
        root.focus({ preventScroll: true })
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(`${game.name} couldn't start: ${err instanceof Error ? err.message : String(err)}`)
        setLoading(false)
      })
    return () => {
      cancelled = true
      observer?.disconnect()
      instanceRef.current?.destroy()
      instanceRef.current = null
      input?.destroy()
      audioRef.current?.destroy()
      audioRef.current = null
      onPlaying(false)
    }
  }, [gameId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sound settings apply at once; other settings apply to the next game.
  useEffect(() => {
    audioRef.current?.setSound(prefs.sound)
    audioRef.current?.setMusic(prefs.music && state?.status === 'running')
  }, [prefs.sound, prefs.music, state?.status])

  // A hidden tab or window pauses the game.
  useEffect(() => {
    if (!active) instanceRef.current?.pause()
  }, [active])
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') instanceRef.current?.pause()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const status = state?.status ?? 'ready'
  const togglePause = (): void => {
    if (status === 'paused') instanceRef.current?.resume()
    else instanceRef.current?.pause()
    rootRef.current?.focus({ preventScroll: true })
  }
  const restart = (): void => {
    setResult(null)
    instanceRef.current?.restart()
    rootRef.current?.focus({ preventScroll: true })
  }

  return (
    <div className={`og-game${prefs.highContrast ? ' contrast' : ''}`}>
      <div className="og-game-bar">
        <button type="button" className="og-btn ghost" onClick={onExit}>
          <ArrowLeft size={14} /> Games
        </button>
        <b className="og-game-name">
          <span aria-hidden>{game.icon}</span> {game.name}
        </b>
        <div className="og-hud" aria-live="off">
          {prefs.showScore && state && (
            <span>
              Score <b>{formatScore(game, state.score)}</b>
            </span>
          )}
          {prefs.showHighScore && best !== undefined && (
            <span>
              Best <b>{formatScore(game, best)}</b>
            </span>
          )}
          {state?.level !== undefined && (
            <span>
              Level <b>{state.level}</b>
            </span>
          )}
          {state?.lives !== undefined && (
            <span>
              Lives <b>{state.lives}</b>
            </span>
          )}
          {state?.hud?.map((h) => (
            <span key={h.label}>
              {h.label} <b>{h.value}</b>
            </span>
          ))}
        </div>
        <div className="og-game-actions">
          <button type="button" className="og-icon-btn" aria-label={status === 'paused' ? 'Resume' : 'Pause'} title={status === 'paused' ? 'Resume' : 'Pause (P)'} onClick={togglePause} disabled={status === 'over' || status === 'ready'}>
            {status === 'paused' ? <Play size={15} /> : <Pause size={15} />}
          </button>
          <button type="button" className="og-icon-btn" aria-label="Restart" title="Restart" onClick={restart}>
            <RotateCcw size={15} />
          </button>
          <button type="button" className="og-icon-btn" aria-label={prefs.sound ? 'Mute' : 'Unmute'} title={prefs.sound ? 'Mute' : 'Unmute'} onClick={() => update((d) => ({ ...d, prefs: { ...d.prefs, sound: !d.prefs.sound } }))}>
            {prefs.sound ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
          <button type="button" className="og-btn small" onClick={onRetry} disabled={retrying} title={host ? `Try loading ${host} again` : 'Try again'}>
            <RefreshCw size={13} className={retrying ? 'og-spin' : undefined} /> {retrying ? 'Trying…' : 'Retry page'}
          </button>
        </div>
      </div>
      <div ref={rootRef} className="og-stage" tabIndex={0} onPointerDown={() => rootRef.current?.focus({ preventScroll: true })} aria-label={`${game.name}. ${game.controls}`}>
        <div ref={surfaceRef} className="game-surface" />
        {loading && <div className="og-overlay">Loading {game.name}…</div>}
        {error && (
          <div className="og-toast" role="alert">
            {error}
            <button type="button" className="og-icon-btn" aria-label="Dismiss" onClick={() => setError(null)}>
              <X size={13} />
            </button>
          </div>
        )}
        {status === 'paused' && !result && (
          <div className="og-overlay">
            <b>Paused</b>
            <button type="button" className="og-btn primary" onClick={togglePause}>
              <Play size={14} /> Resume
            </button>
          </div>
        )}
        {result && (
          <div className="og-overlay" role="dialog" aria-label="Game over">
            <b>{game.id === 'minesweeper' || game.id === 'memory-match' || game.id === 'typing-challenge' || game.id === 'reaction-test' ? 'Finished' : 'Game over'}</b>
            <span className="og-final">{formatScore(game, result.score)}</span>
            {result.newBest ? <span className="og-best">New best!</span> : result.previousBest !== undefined && <span className="og-muted">Best {formatScore(game, result.previousBest)}</span>}
            <div className="og-inline">
              <button type="button" className="og-btn primary" onClick={restart}>
                <RotateCcw size={14} /> Play again
              </button>
              <button type="button" className="og-btn" onClick={onExit}>
                Other games
              </button>
            </div>
          </div>
        )}
      </div>
      <p className="og-controls og-muted">{game.controls} · P or Enter pauses</p>
    </div>
  )
}

export { DEFAULT_PREFS }
