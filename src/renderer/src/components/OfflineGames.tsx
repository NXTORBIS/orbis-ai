import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BarChart3, Gamepad2, Pause, Play, RefreshCw, RotateCcw, Search, Settings2, Star, Trophy, Volume2, VolumeX, Wifi, WifiOff, X } from 'lucide-react'
import type { GameCategory, GameId, GameInfo, LoadFailureKind, OfflineGamesPrefs, ScoreRecord } from '../../../shared/offlineGames'
import { DEFAULT_PREFS, GAMES, gameInfo, gameOfTheDay, launchChoice, randomGame, searchGames } from '../../../shared/offlineGames'
import type { DayRules } from '../../../shared/games/calendar'
import type { GameSort, KeptArcade } from '../../../shared/games/kept'
import { continuable, forgetArcade, sortGames, spellTime } from '../../../shared/games/kept'
import { finishRun } from '../../../shared/games/finish'
import type { GameInstance, GamePrefs, GameState } from '../games/engine'
import { createAudio, createInput } from '../games/engine'
import { GAME_LOADERS } from '../games'
import { dayRulesFor, useOfflineGames } from '../games/useOfflineGames'
import { useSurface } from '../lib/surfaces'
import { arcadeSurface, catalogueSurface, playingSurface } from './arcadeSurfaces'
import { ArcadeNotes } from './ArcadeNotes'
import { ArcadeStats, GameBoard } from './ArcadeStats'
import { ArcadeProgress } from './ArcadeProgress'
import '../games/games.css'

/**
 * The arcade, and the page it is reached from when a page cannot load.
 *
 * It was built for twelve games in one flat grid; there are thirty-two now, which is the one change a flat grid
 * cannot absorb. So there is a search box, the categories the catalogue actually uses, four orderings, favourites
 * pinned above the rest, a row for the games you left part way through, and the boards. Nothing was taken away to
 * make room: the game of the day, the random button, the recently played row, the settings and every one of the
 * original twelve are exactly where they were.
 *
 * ## Scores come from the profile, so there is a moment before they arrive
 *
 * `useOfflineGames` answers with `record: null` until the profile has been read, and this screen says it is reading
 * rather than drawing an empty high-score table. That is not politeness: a table of dashes drawn for a second is
 * indistinguishable from "your scores are gone", and somebody who has played for a year would believe it.
 *
 * ## Nothing in here imports a game
 *
 * Every game is its own lazily loaded chunk (`../games/index.ts`), reached only through `GAME_LOADERS`. Importing
 * one here would put all thirty-two into the chunk the arcade itself is in, and the grid would cost a megabyte to
 * open.
 */

/**
 * A run opened as the day's challenge.
 *
 * The seed is what makes the challenge the same board all day for the games that lay themselves out from one; the id
 * is which challenge the run is an attempt at. A game that does not read a seed still gets the same target.
 */
interface ChallengeRun {
  seed: number | null
  challengeId: string
}

const CATEGORIES: { id: GameCategory | 'all' | 'favorites'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'favorites', label: 'Favourites' },
  { id: 'arcade', label: 'Arcade' },
  { id: 'puzzle', label: 'Puzzle' },
  { id: 'logic', label: 'Logic' },
  { id: 'cards', label: 'Cards' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'reaction', label: 'Reaction' },
  { id: 'rhythm', label: 'Rhythm' },
  { id: 'physics', label: 'Physics' },
  { id: 'classic', label: 'Classic' },
  { id: 'casual', label: 'Casual' },
  { id: 'typing', label: 'Typing' }
]

const SORTS: { id: GameSort; label: string }[] = [
  { id: 'name', label: 'By name' },
  { id: 'recent', label: 'Recently played' },
  { id: 'best', label: 'Best score' },
  { id: 'played', label: 'Most played' }
]

/**
 * A score with the unit it is actually in.
 *
 * `lower-ms` in the catalogue means "less is better", and for most of those games the number really is a time. Angle
 * Shot's is a count of shots, so writing "28 ms" under it would be telling the player something untrue about their own
 * round.
 */
const formatScore = (game: GameInfo, value: number): string =>
  game.score === 'lower-ms' ? (game.id === 'angle-shot' ? `${value} shot${value === 1 ? '' : 's'}` : `${value} ms`) : game.score === 'wpm' ? `${value} WPM` : value.toLocaleString()

/** An hour of the day in the words somebody would use, for "my day starts at". */
const spellHour = (hour: number): string => {
  if (hour === 0) return 'Midnight'
  if (hour === 12) return 'Midday'
  if (hour < 12) return `${hour} in the morning`
  if (hour < 18) return `${hour - 12} in the afternoon`
  return `${hour - 12} in the evening`
}

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

type Update = (change: (record: KeptArcade) => KeptArcade) => void

/**
 * The page that would not load, when the arcade is attached to one.
 *
 * It is one optional object rather than six loose props because the two things the arcade can be are exactly "a page
 * failed and here is something to do" and "somebody opened the arcade". Everything about the failed page -- its
 * address, what went wrong, and the way back to it -- belongs to the first and has no meaning in the second, so
 * having it present or absent is what tells the screen which one it is. Six optional props could be half filled in,
 * and a "Retry page" button with nothing to retry is the kind of dead control this change exists to remove.
 */
export interface FailedPage {
  url: string
  reason: string
  kind: LoadFailureKind
  retrying: boolean
  onRetry(): void
}

interface Props {
  /** Absent when the arcade was opened as a screen in its own right. */
  page?: FailedPage
  /** This tab or screen is the one on show; games pause when it isn't. Defaults to on show. */
  active?: boolean
  /** Shown as a way out when the arcade is a screen of its own. The offline page has no "close". */
  onClose?(): void
}

/**
 * The arcade, in both the places it can appear.
 *
 * With a `page` it is the Orbis offline page: what went wrong, a retry, and games to play while waiting. Each tab
 * has its own, and a game pauses when its tab is hidden.
 *
 * Without one it is the Arcade screen in the window, opened from the Orbis menu or the box of everything, and it
 * starts in the catalogue. The offline wording, the retry and the "you're back online" banner are all page business
 * and are not drawn at all: a screen somebody chose to open is not an error, and must not be dressed as one.
 */
export default function OfflineGames({ page, active = true, onClose }: Props): React.JSX.Element {
  const arcade = useOfflineGames()
  const kept = arcade.record
  const prefs = kept?.library.prefs ?? DEFAULT_PREFS
  const rules = useMemo(() => dayRulesFor(kept), [kept?.dayStartHour])
  const online = useOnline()
  const [view, setView] = useState<'page' | 'ask' | 'library' | 'game'>(page ? 'page' : 'library')
  const [gameId, setGameId] = useState<GameId | null>(null)
  const [continueSaved, setContinueSaved] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [playing, setPlaying] = useState(false)
  /*
   * What a failed page should do is a preference, and the preference is in the profile.
   *
   * So the first view cannot be decided while the component is being created -- it used to be, off a `localStorage`
   * read that happened to be synchronous. It is decided once, when the answer arrives, so it never overrides
   * something somebody has since navigated to.
   *
   * The preference is about what a *failed page* should do, so it is only read when there is a failed page. Opening
   * the Arcade from the menu always lands on the catalogue, whatever that preference says: being thrown straight
   * into one game by a screen you opened to choose a game is not the preference being honoured, it is it misfiring.
   */
  const settled = useRef(false)
  useEffect(() => {
    if (!page || kept === null || settled.current) return
    settled.current = true
    if (prefs.behavior === 'auto-launch') {
      setGameId(launchChoice(kept.library, new Date()))
      setView('game')
    } else if (prefs.behavior === 'ask') setView('ask')
  }, [kept]) // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * The connection came back after being lost while this page was open.
   *
   * Only watched when there is a page to go back to. In the Arcade screen the network coming back is not news, and a
   * "Reload page" button there would have nothing to reload.
   */
  const wasOffline = useRef(!navigator.onLine)
  const [recovered, setRecovered] = useState(false)
  useEffect(() => {
    if (!page) return
    if (!online) {
      wasOffline.current = true
      setRecovered(false)
      return
    }
    if (!wasOffline.current) return
    wasOffline.current = false
    if (prefs.autoRetry && !playing) page.onRetry()
    else setRecovered(true)
  }, [online]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Set while the run on screen is an attempt at a day's challenge. Null for ordinary play. */
  const [run, setRun] = useState<ChallengeRun | null>(null)

  const host = useMemo(() => {
    if (!page) return ''
    try {
      return new URL(page.url).host
    } catch {
      return page.url
    }
  }, [page?.url])

  const open = (id: GameId, resume = false, run?: ChallengeRun): void => {
    setGameId(id)
    setContinueSaved(resume)
    setRun(run ?? null)
    setView('game')
  }

  const setPref = <K extends keyof OfflineGamesPrefs>(key: K, value: OfflineGamesPrefs[K]): void =>
    arcade.update((r) => ({ ...r, library: { ...r.library, prefs: { ...r.library.prefs, [key]: value } } }))

  /*
   * What the arcade lets Orbis read, set and do.
   *
   * Registered on the shell rather than on the catalogue, because the shell is the part that is always here: the
   * catalogue is one of its four screens and a game being played is another, and both come and go. The catalogue's own
   * search and filters are registered by `Library`, and a game's pause and restart by `GameView`, so each thing is
   * declared by whatever really holds it.
   *
   * Every getter about the record throws until the profile has answered, which is the same rule this screen follows
   * for itself: it says it is reading rather than drawing an empty table.
   */
  const record = (): KeptArcade => {
    if (kept === null) throw new Error('Your games have not been read from this profile yet.')
    return kept
  }
  useSurface(
    arcadeSurface({
      view: () => view,
      setView: (id) => setView(id as typeof view),
      // Only the screens this copy of the arcade really has. The offline page and the question it asks belong to a
      // failed load; offering Orbis a way to switch to them in the Arcade screen would be offering a screen that
      // would draw "you're offline" over a working connection.
      views: page ? ['page', 'ask', 'library', 'game'] : ['library', 'game'],
      prefs: () => record().library.prefs,
      setPref,
      dayStartHour: () => record().dayStartHour,
      setDayStartHour: (hour) => arcade.update((r) => ({ ...r, dayStartHour: hour })),
      refused: () => arcade.refused,
      favourites: () => record().library.favorites,
      setFavourite: (id, on) =>
        arcade.update((r) => ({
          ...r,
          library: { ...r.library, favorites: on ? [...new Set([...r.library.favorites, id])] : r.library.favorites.filter((one) => one !== id) }
        })),
      unfinished: () => continuable(record()).map((one) => one.gameId),
      best: (id) => record().library.scores[id]?.best,
      daily: () => gameOfTheDay(new Date()),
      play: (id, resume) => open(id, resume === true),
      playing: () => (view === 'game' ? gameId : null)
    })
  )

  const banner = recovered && page && (
    <div className="og-recovered" role="status">
      <Wifi size={15} />
      <span>You're back online.</span>
      <button type="button" className="og-btn primary" onClick={page.onRetry}>
        Reload page
      </button>
      <button type="button" className="og-icon-btn" aria-label="Dismiss" onClick={() => setRecovered(false)}>
        <X size={14} />
      </button>
    </div>
  )

  return (
    <div className="og" data-kind={page?.kind ?? 'arcade'}>
      {banner}
      {view === 'game' && kept !== null && gameId !== null ? (
        <GameView
          key={`${gameId}-${continueSaved}-${run?.challengeId ?? ''}`}
          gameId={gameId}
          seed={run?.seed ?? null}
          kept={kept}
          rules={rules}
          update={arcade.update}
          refused={arcade.refused}
          active={active}
          resume={continueSaved}
          onPlaying={setPlaying}
          onExit={() => {
            setPlaying(false)
            setView('library')
          }}
          page={page}
          host={host}
        />
      ) : (
        <div className="og-page">
          {page ? (
            <header className="og-head">
              <div className="og-status">
                <WifiOff size={30} />
                <div>
                  <h2>{page.kind === 'no-internet' ? "You're offline" : "This page can't be reached"}</h2>
                  <p>
                    {page.reason}
                    {host ? ` · ${host}` : ''}
                  </p>
                  <p className="og-muted">{online ? 'Your device reports a network connection; the site may be down or blocked.' : 'Check your Wi-Fi or network cable.'}</p>
                </div>
              </div>
              <div className="og-head-actions">
                <button type="button" className="og-btn primary" onClick={page.onRetry} disabled={page.retrying}>
                  <RefreshCw size={14} className={page.retrying ? 'og-spin' : undefined} /> {page.retrying ? 'Trying…' : 'Try again'}
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
          ) : (
            /*
             * The Arcade screen's own heading.
             *
             * Deliberately not the offline one with the words swapped. The offline header's whole shape -- a large
             * disconnected-network picture, a line saying what went wrong, and "Try again" as the main action -- is
             * about a page that failed, and none of it is true here.
             */
            <header className="og-head og-head-arcade">
              <div className="og-status">
                <Gamepad2 size={30} />
                <div>
                  <h2>Arcade</h2>
                  <p className="og-muted">{GAMES.length} games, all of them offline. Your scores and unfinished games are kept in this profile.</p>
                </div>
              </div>
              <div className="og-head-actions">
                <button type="button" className="og-icon-btn" aria-label="Game settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((v) => !v)}>
                  <Settings2 size={16} />
                </button>
                {onClose && (
                  <button type="button" className="og-icon-btn" aria-label="Close the arcade" title="Close" onClick={onClose}>
                    <X size={16} />
                  </button>
                )}
              </div>
            </header>
          )}
          <ArcadeNotes arcade={arcade} />
          {view === 'ask' && kept !== null && (
            <div className="og-ask">
              <span>Play a game while you wait?</span>
              <button type="button" className="og-btn primary" onClick={() => open(launchChoice(kept.library, new Date()))}>
                Play {gameInfo(launchChoice(kept.library, new Date())).name}
              </button>
              <button type="button" className="og-btn" onClick={() => setView('library')}>
                Choose a game
              </button>
              <button type="button" className="og-btn ghost" onClick={() => setView('page')}>
                No thanks
              </button>
            </div>
          )}
          {view === 'library' && settingsOpen && kept !== null && (
            <GameSettings
              prefs={kept.library.prefs}
              setPref={setPref}
              day={{ hour: kept.dayStartHour, setHour: (hour) => arcade.update((r) => ({ ...r, dayStartHour: hour })) }}
              onReset={() => arcade.update(forgetArcade)}
            />
          )}
          {view === 'library' &&
            (kept === null ? (
              <p className="og-muted og-reading">Reading your scores…</p>
            ) : (
              <Library kept={kept} rules={rules} update={arcade.update} onOpen={open} />
            ))}
        </div>
      )}
    </div>
  )
}

function Library({ kept, rules, update, onOpen }: { kept: KeptArcade; rules: DayRules; update: Update; onOpen(id: GameId, resume?: boolean, run?: ChallengeRun): void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<GameCategory | 'all' | 'favorites'>('all')
  const [sort, setSort] = useState<GameSort>('name')
  const [pinFavourites, setPinFavourites] = useState(true)
  const [boards, setBoards] = useState(false)
  const [chosen, setChosen] = useState<GameId | null>(null)
  const library = kept.library

  /*
   * Searched, filtered and ordered once per change rather than once per render.
   *
   * At twelve games this was free. At thirty-two, with four orderings and a comparison that has to ask the catalogue
   * which way round each game's score counts, it is work that would otherwise happen again on every keystroke in the
   * search box -- and again on every keystroke anywhere else on the page.
   */
  const games = useMemo(() => {
    const matched = searchGames(query, category, library.favorites)
    return sortGames(matched.map((one) => one.id), kept, sort, pinFavourites).map((id) => gameInfo(id))
  }, [query, category, sort, pinFavourites, library.favorites, library.scores])

  /*
   * How long each game has been played for, worked out once rather than once per card.
   *
   * Thirty-two cards each asking the run list for their own total is thirty-two passes over four hundred runs, on
   * every keystroke in the search box. One pass builds all of them.
   */
  const times = useMemo(() => {
    const totals = new Map<GameId, number>()
    for (const play of kept.record.plays) {
      if (play.seconds === undefined) continue
      totals.set(play.gameId, (totals.get(play.gameId) ?? 0) + Math.max(0, play.seconds) * 1000)
    }
    return totals
  }, [kept.record.plays])

  const daily = gameInfo(gameOfTheDay(new Date()))
  const unfinished = useMemo(() => continuable(kept), [library.saved])

  /*
   * What the catalogue lets Orbis read and set.
   *
   * Here rather than on the shell because this is where the search box and the filters really live. `shown` is the
   * list after the search, the category and the ordering -- the same array the grid draws, so what Orbis is told is
   * showing is what is on screen.
   */
  useSurface(
    catalogueSurface({
      search: () => query,
      setSearch: setQuery,
      category: () => category,
      setCategory: (id) => setCategory(id as GameCategory | 'all' | 'favorites'),
      categories: CATEGORIES,
      sort: () => sort,
      setSort: (id) => setSort(id as GameSort),
      sorts: SORTS,
      favouritesFirst: () => pinFavourites,
      setFavouritesFirst: setPinFavourites,
      boardsOpen: () => boards,
      setBoardsOpen: setBoards,
      shown: () => games
    })
  )
  const toggleFavorite = (id: GameId): void =>
    update((r) => ({
      ...r,
      library: { ...r.library, favorites: r.library.favorites.includes(id) ? r.library.favorites.filter((one) => one !== id) : [...r.library.favorites, id] }
    }))

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
        <button type="button" className="og-btn" onClick={() => onOpen(randomGame(undefined, library.recent[0]?.gameId))}>
          Random game
        </button>
        <button type="button" className={`og-btn${boards ? ' primary' : ''}`} aria-pressed={boards} onClick={() => setBoards((v) => !v)}>
          <BarChart3 size={14} /> Your scores
        </button>
      </div>

      {boards && (
        <div className="og-panel">
          <ArcadeStats kept={kept} rules={rules} onOpen={(id) => setChosen(id)} />
          <label className="og-setting">
            <span>One game in detail</span>
            <select value={chosen ?? ''} onChange={(e) => setChosen((e.target.value || null) as GameId | null)}>
              <option value="">Choose a game…</option>
              {GAMES.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </label>
          {chosen !== null && <GameBoard kept={kept} gameId={chosen} />}
          <p className="og-muted og-local">
            All of this is kept in this profile on this computer. Nothing is sent anywhere, there is no account, and it travels with a profile export.
          </p>
        </div>
      )}

      <ArcadeProgress
        kept={kept}
        rules={rules}
        onGoal={(id) => update((r) => ({ ...r, goalId: id }))}
        onPlay={(id, challenge) => onOpen(id, false, challenge)}
      />

      {/* The games you left part way through. Only the ones the catalogue says can be continued save anything. */}
      {unfinished.length > 0 && (
        <div className="og-recent" aria-label="Carry on">
          <small>Carry on where you left off</small>
          <div className="og-recent-row">
            {unfinished.map((one) => {
              const game = gameInfo(one.gameId)
              return (
                <button key={one.gameId} type="button" className="og-chip on" onClick={() => onOpen(one.gameId, true)}>
                  <span aria-hidden>{game.icon}</span> {game.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {library.recent.length > 0 && (
        <div className="og-recent" aria-label="Recently played">
          <small>Recently played</small>
          <div className="og-recent-row">
            {library.recent.slice(0, 6).map((one) => {
              const game = gameInfo(one.gameId)
              return (
                <button key={one.gameId} type="button" className="og-chip" onClick={() => onOpen(one.gameId)}>
                  <span aria-hidden>{game.icon}</span> {game.name} <span className="og-muted">{formatScore(game, one.score)}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="og-filters">
        <div className="og-filter-row">
          <label className="og-search">
            <Search size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search games" aria-label="Search games" />
          </label>
          <label className="og-sort">
            <span className="og-muted">Order</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as GameSort)} aria-label="Order the games by">
              {SORTS.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={`og-chip${pinFavourites ? ' on' : ''}`} aria-pressed={pinFavourites} onClick={() => setPinFavourites((v) => !v)}>
            <Star size={12} fill={pinFavourites ? 'currentColor' : 'none'} /> Favourites first
          </button>
        </div>
        <div className="og-cats" role="tablist" aria-label="Categories">
          {CATEGORIES.map((one) => (
            <button key={one.id} type="button" role="tab" aria-selected={category === one.id} className={`og-chip${category === one.id ? ' on' : ''}`} onClick={() => setCategory(one.id)}>
              {one.label}
            </button>
          ))}
        </div>
        <p className="og-count og-muted" role="status">
          {games.length} of {GAMES.length} games
        </p>
      </div>

      <div className="og-grid">
        {games.map((game) => {
          const score = library.scores[game.id]
          const played = times.get(game.id) ?? 0
          const saved = library.saved[game.id]
          const favorite = library.favorites.includes(game.id)
          return (
            <div key={game.id} className="og-card">
              <button type="button" className="og-card-main" onClick={() => onOpen(game.id)} aria-label={`Play ${game.name}`}>
                <span className="og-card-icon" aria-hidden>
                  {game.icon}
                </span>
                <b>{game.name}</b>
                <span className="og-muted">{game.description}</span>
                <span className="og-card-meta">
                  {score ? (
                    <>
                      <Trophy size={12} /> {formatScore(game, score.best)} · {score.plays} game{score.plays === 1 ? '' : 's'}
                      {played > 0 ? ` · ${spellTime(played)}` : ''}
                    </>
                  ) : (
                    'Not played yet'
                  )}
                </span>
              </button>
              <div className="og-card-actions">
                {saved && (
                  <button type="button" className="og-btn small" onClick={() => onOpen(game.id, true)}>
                    Continue
                  </button>
                )}
                <button
                  type="button"
                  className={`og-icon-btn${favorite ? ' fav' : ''}`}
                  aria-label={favorite ? `Remove ${game.name} from favourites` : `Add ${game.name} to favourites`}
                  aria-pressed={favorite}
                  onClick={() => toggleFavorite(game.id)}
                >
                  <Star size={15} fill={favorite ? 'currentColor' : 'none'} />
                </button>
              </div>
            </div>
          )
        })}
        {!games.length && <p className="og-muted">No games match. Try another word, or choose All.</p>}
      </div>
    </div>
  )
}

function GameSettings({ prefs, setPref, day, onReset }: { prefs: OfflineGamesPrefs; setPref: <K extends keyof OfflineGamesPrefs>(key: K, value: OfflineGamesPrefs[K]) => void; day: { hour: number; setHour(hour: number): void }; onReset(): void }): React.JSX.Element {
  const [confirmReset, setConfirmReset] = useState(false)
  return <OfflineGameSettingsFields prefs={prefs} setPref={setPref} day={day} extra={
    <div className="og-setting">
      <span>Scores, runs and saved games</span>
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

/**
 * The games' preferences, used in the arcade and in Orbis settings.
 *
 * `day` is separate from `prefs` because it is kept in a different place: the preferences are the library's own, and
 * when a day begins belongs to the whole record, since it decides what counts as a run of days. It is optional so a
 * screen that has not read the record yet can still draw the preferences.
 */
export function OfflineGameSettingsFields({ prefs, setPref, day, extra }: {
  prefs: OfflineGamesPrefs
  setPref: <K extends keyof OfflineGamesPrefs>(key: K, value: OfflineGamesPrefs[K]) => void
  day?: { hour: number; setHour(hour: number): void }
  extra?: React.ReactNode
}): React.JSX.Element {
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
      {day && (
        <label className="og-setting">
          <span>My day starts at</span>
          {/* Somebody who plays at one in the morning wants that to count as the night before, or their run of days
              breaks every time. Whole hours only: `calendar.ts` counts a day from an hour, not from a minute. */}
          <select value={String(day.hour)} onChange={(e) => day.setHour(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {spellHour(hour)}
              </option>
            ))}
          </select>
        </label>
      )}
      {extra}
    </div>
  )
}

interface GameViewProps {
  gameId: GameId
  /** The day's seed, for a challenge run of a game that lays its board out from one. Null for ordinary play. */
  seed: number | null
  kept: KeptArcade
  rules: DayRules
  update: Update
  /** Set when the record could not be read, so a preference on this screen says it cannot be written. */
  refused: string | null
  active: boolean
  resume: boolean
  /** The failed page this run is being played on, if any. Absent in the Arcade screen. */
  page?: FailedPage
  host: string
  onPlaying(playing: boolean): void
  onExit(): void
}

function GameView({ gameId, seed, kept, rules, update, refused, active, resume, page, host, onPlaying, onExit }: GameViewProps): React.JSX.Element {
  const game = gameInfo(gameId)
  const systemReduced = usePrefersReducedMotion()
  const prefs = kept.library.prefs
  const rootRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<GameInstance | null>(null)
  const audioRef = useRef<ReturnType<typeof createAudio> | null>(null)
  const [state, setState] = useState<GameState | null>(null)
  const [result, setResult] = useState<{ score: number; newBest: boolean; previousBest?: number; earned: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const best = kept.library.scores[gameId]?.best
  /*
   * How long the run lasted, for the time played.
   *
   * The game's own `elapsedMs` is preferred, because it stops while the game is paused. Wall clock since it started
   * is the fallback for a game that never reports one, which would otherwise record every run as having taken no
   * time at all -- and "time played: 0 seconds" after an hour is a figure that makes the whole board look broken.
   */
  const elapsedRef = useRef(0)
  const startedRef = useRef(performance.now())

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
    /*
     * The seed, handed to the game through the stage.
     *
     * `games/seed.ts` is the other end of it: a game asks there for its random source and gets a seeded one when the
     * attribute is set and `Math.random` when it is not. It is an attribute rather than a field on the context so
     * that a game which has never heard of the day's challenge is unaffected, and so the games' own contract --
     * `engine.ts` -- did not have to change for it.
     */
    if (seed === null) delete root.dataset.gameSeed
    else root.dataset.gameSeed = String(seed)
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
        startedRef.current = performance.now()
        const instance = mod.create({
          gameId,
          root,
          canvas,
          prefs: gamePrefs,
          best: kept.library.scores[gameId]?.best,
          input,
          audio,
          emit: (s) => {
            setState(s)
            if (s.elapsedMs > 0) elapsedRef.current = s.elapsedMs
            onPlaying(s.status === 'running')
          },
          over: ({ score, extra }: { score: number; extra?: ScoreRecord['extra'] }) => {
            const ms = elapsedRef.current > 0 ? elapsedRef.current : performance.now() - startedRef.current
            const now = Date.now()
            // Held on an object rather than in a local, because what the run earned is worked out inside the change
            // -- it needs the record as it is now -- and has to come back out to be shown.
            const outcome: { shown: { score: number; newBest: boolean; previousBest?: number; earned: string } | null } = { shown: null }
            update((r) => {
              /*
               * One call, so the best score and the run cannot disagree.
               *
               * `finishRun` consults the score store first and writes what it said onto the run, which is the only
               * way `newBest` on a run can be true rather than guessed at -- and the five points for beating your
               * own record ride on it.
               */
              const done = finishRun(r, { gameId, score, extra, ms }, { now, rules, ...(r.goalId !== null ? { goalId: r.goalId } : {}), libraryGames: GAMES.length })
              outcome.shown = { score, newBest: done.newBest, previousBest: done.previousBest, earned: done.earned.says }
              return done.kept
            })
            setResult(outcome.shown)
            // The next run is its own run: both counters start again, or a second game would be recorded as having
            // taken as long as the first and the second together.
            elapsedRef.current = 0
            startedRef.current = performance.now()
            onPlaying(false)
          },
          save: game.continuable ? (saved) => update((r) => {
            const next = { ...r.library.saved }
            if (saved === null || saved === undefined) delete next[gameId]
            else next[gameId] = { state: saved, savedAt: Date.now() }
            return { ...r, library: { ...r.library, saved: next } }
          }) : undefined
        })
        instanceRef.current = instance
        const fit = (): void => {
          const rect = surface.getBoundingClientRect()
          if (rect.width > 10 && rect.height > 10) instance.resize(Math.floor(rect.width), Math.floor(rect.height))
        }
        fit()
        instance.start()
        const saved = kept.library.saved[gameId]
        if (resume && saved && instance.restore && !instance.restore(saved.state)) {
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
      delete root.dataset.gameSeed
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
    elapsedRef.current = 0
    startedRef.current = performance.now()
    instanceRef.current?.restart()
    rootRef.current?.focus({ preventScroll: true })
  }

  /*
   * What a game being played lets Orbis read, set and do.
   *
   * Only what the shared engine gives every game: pause, resume, start again, and the status, score and few numbers
   * the game itself reports. Nothing reaches into a particular game's rules -- those are the game's, and there are
   * thirty-two of them.
   *
   * `reported` is the game's own last word about itself rather than anything worked out here, which is what makes
   * "did it pause?" answerable: a game that ignored the request still says `running`.
   */
  useSurface(
    playingSurface({
      game: () => game,
      reported: () => state,
      loading: () => loading,
      best: () => best,
      prefs: () => prefs,
      setPref: (key, value) => update((r) => ({ ...r, library: { ...r.library, prefs: { ...r.library.prefs, [key]: value } } })),
      // Threaded in rather than assumed to be fine: while the record could not be read, nothing may be written over
      // it, and a control that said it was settable would put a default over somebody's scores.
      refused: () => refused,
      pause: () => instanceRef.current?.pause(),
      resume: () => instanceRef.current?.resume(),
      restart,
      exit: onExit
    })
  )

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
          <button type="button" className="og-icon-btn" aria-label={prefs.sound ? 'Mute' : 'Unmute'} title={prefs.sound ? 'Mute' : 'Unmute'} onClick={() => update((r) => ({ ...r, library: { ...r.library, prefs: { ...r.library.prefs, sound: !r.library.prefs.sound } } }))}>
            {prefs.sound ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
          {/* Only when there is a page waiting behind the game. In the Arcade screen there is nothing to retry. */}
          {page && (
            <button type="button" className="og-btn small" onClick={page.onRetry} disabled={page.retrying} title={host ? `Try loading ${host} again` : 'Try again'}>
              <RefreshCw size={13} className={page.retrying ? 'og-spin' : undefined} /> {page.retrying ? 'Trying…' : 'Retry page'}
            </button>
          )}
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
            <b>{FINISHES.has(game.id) ? 'Finished' : 'Game over'}</b>
            <span className="og-final">{formatScore(game, result.score)}</span>
            {result.newBest ? <span className="og-best">New best!</span> : result.previousBest !== undefined && <span className="og-muted">Best {formatScore(game, result.previousBest)}</span>}
            {/* What the run earned, in the arcade's own words, so the number is never shown without its reason. */}
            <span className="og-muted og-earned">{result.earned}</span>
            <div className="og-inline">
              <button type="button" className="og-btn primary" onClick={restart}>
                Play again
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

/**
 * The games that end by being completed rather than by going wrong.
 *
 * A list rather than a condition on the category, because the category does not answer it: Crate Pusher and Gem Swap
 * are both puzzles, and one of them you finish while the other you survive. "Game over" on a solved Sudoku reads as
 * a failure, which is the opposite of what happened.
 */
const FINISHES = new Set<GameId>([
  'minesweeper',
  'memory-match',
  'typing-challenge',
  'reaction-test',
  'sokoban',
  'lights-out',
  'pipes',
  'sudoku',
  'nonogram',
  'water-sort',
  'sliding-tiles',
  'solitaire',
  'angle-shot'
])

export { DEFAULT_PREFS }
