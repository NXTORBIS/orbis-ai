import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { EmptyState } from '../../ui'
import type { NoticeKind } from '../../lib/notices'
import { useSurface } from '../../lib/surfaces'
import type { StoredGame } from '../../../../shared/chess/model'
import { chessSurface } from './chessSurfaces'
import { applyStoredChessBoardSettings } from './settings/chessSettingsStore'
import './chess.css'

/**
 * Chess World: the one screen, and the way to everything in it.
 *
 * This file is a shell and nothing else. It owns three things -- which area you are in, the list of your games, and
 * which game is open -- and every area below brings its own board, its own panels and its own stylesheet. That is
 * deliberate: the thing that went wrong here before was that sixty React files were written for Chess World and this
 * file imported none of them, so a finished Academy, Endgame Lab, puzzle trainer and analysis studio all existed and
 * a person could reach a bare board and four tabs. Anything added to Chess World from here on has to appear in
 * `GROUPS` or nobody can open it.
 *
 * What an area may do with a game is not decided here. It is `SESSION_RIGHTS` in the model, read by the area itself
 * (Sections 019, 022) -- so a game you are watching cannot be played, and this shell holds no opinion about it. The
 * old version of this file decided interactivity for itself, which is exactly the second opinion that rule forbids.
 */

const Academy = lazy(() => import('./academy/Academy').then((m) => ({ default: m.Academy })))
const AnalysisStudio = lazy(() => import('./analysis/AnalysisStudio'))
const ArenaGame = lazy(() => import('./arena/ArenaGame').then((m) => ({ default: m.ArenaGame })))
const CoachArea = lazy(() => import('./coach/CoachArea'))
const PositionEditor = lazy(() => import('./editor/PositionEditor').then((m) => ({ default: m.PositionEditor })))
const EndgameLab = lazy(() => import('./endgames/EndgameLab').then((m) => ({ default: m.EndgameLab })))
const FamousGames = lazy(() => import('./famous/FamousGames'))
const GameLibrary = lazy(() => import('./library/GameLibrary'))
const LiveChess = lazy(() => import('./live/LiveChess'))
const OpeningLab = lazy(() => import('./openings/OpeningLab'))
const PuzzleWorkspace = lazy(() => import('./puzzles/PuzzleWorkspace'))
const PositionSearch = lazy(() => import('./search/PositionSearch').then((m) => ({ default: m.PositionSearch })))
const ReferencePanel = lazy(() => import('./search/ReferencePanel').then((m) => ({ default: m.ReferencePanel })))
const CalculationGym = lazy(() => import('./training/CalculationGym').then((m) => ({ default: m.CalculationGym })))
const Blindfold = lazy(() => import('./training/Blindfold').then((m) => ({ default: m.Blindfold })))
const Drills = lazy(() => import('./training/Drills').then((m) => ({ default: m.Drills })))
const VisionTrainer = lazy(() => import('./training/Vision').then((m) => ({ default: m.Vision })))
const GameReview = lazy(() => import('./review/GameReview').then((m) => ({ default: m.GameReview })))
const Board3DArea = lazy(() => import('./three/Board3DArea').then((m) => ({ default: m.Board3DArea })))
const ChessSettings = lazy(() => import('./settings/ChessSettings'))
const ShortcutHelp = lazy(() => import('./settings/ShortcutHelp').then((m) => ({ default: m.ShortcutHelp })))

export type AreaId =
  | 'play' | 'puzzles' | 'endgames'
  | 'calculation' | 'blindfold' | 'drills' | 'vision'
  | 'academy' | 'openings' | 'famous' | 'coach'
  | 'library' | 'study' | 'review' | 'find' | 'live'
  | 'editor' | 'board3d' | 'reference' | 'settings'

interface Area {
  id: AreaId
  label: string
  /** One line, shown under the name in the rail. It says what the area is for, not what it is called. */
  blurb: string
}

/**
 * The rail, grouped by what you came to do rather than by how the code is arranged.
 *
 * The labels are always on screen. The browser's own rail hid its labels until you hovered and left eleven
 * unexplained icons in a column, which is the mistake this does not repeat.
 */
export const GROUPS: { title: string; areas: Area[] }[] = [
  {
    title: 'Play',
    areas: [
      { id: 'play', label: 'Play', blurb: 'A game against the engine, or both sides yourself' },
      { id: 'puzzles', label: 'Puzzles', blurb: 'Solve them, and make them out of your own games' },
      { id: 'endgames', label: 'Endgames', blurb: 'Endings, played out, with the claim proved' }
    ]
  },
  {
    title: 'Train',
    areas: [
      { id: 'calculation', label: 'Calculation Gym', blurb: 'Work a line out in your head and write it down' },
      // The whole game with no board is one of Blindfold's own five rounds, not a separate place. It had an entry
      // of its own here for about an hour, which is two doors to one thing -- the exact duplication that made
      // Chess World hard to find its way around in the first place.
      { id: 'blindfold', label: 'Blindfold', blurb: 'Hold the position in your head. Five rounds, and a whole game' },
      { id: 'drills', label: 'Drills', blurb: 'Play a position out against the engine until you win it' },
      { id: 'vision', label: 'Vision', blurb: 'Name the square, or find it, against a clock' }
    ]
  },
  {
    title: 'Learn',
    areas: [
      { id: 'academy', label: 'Academy', blurb: 'Lessons and tasks, in an order that builds' },
      { id: 'openings', label: 'Openings', blurb: 'Explore the dataset and keep a repertoire' },
      { id: 'famous', label: 'Famous games', blurb: 'Games that were really played, move by move' },
      { id: 'coach', label: 'Coach', blurb: 'What the record shows, and what it cannot' }
    ]
  },
  {
    title: 'Your games',
    areas: [
      { id: 'library', label: 'Library', blurb: 'Everything you own, searched and filtered' },
      { id: 'study', label: 'Study', blurb: 'One game, the engine, and your notes' },
      { id: 'review', label: 'Game Review', blurb: 'How one of your games went, move by move' },
      { id: 'find', label: 'Find a position', blurb: 'A position across your own games' },
      { id: 'live', label: 'Live', blurb: 'Tournaments being broadcast publicly' }
    ]
  },
  {
    title: 'Tools',
    areas: [
      { id: 'editor', label: 'Set up a position', blurb: 'Place pieces freely and check what you made' },
      { id: 'board3d', label: 'Board in 3D', blurb: 'The same board, drawn in three dimensions' },
      { id: 'reference', label: 'Reference data', blurb: 'Which datasets are really on this computer' },
      { id: 'settings', label: 'Settings', blurb: 'The board, the engine, sound and notation' }
    ]
  }
]

const ALL_AREAS: Area[] = GROUPS.flatMap((group) => group.areas)
const WHERE_KEY = 'orbis.chess.area'

/**
 * Where the number keys go. The key sheet advertises 1 to 4, and this is what they are.
 *
 * Written here rather than in the sheet's own file because this is the handler: the sheet reads `CHESS_SHORTCUTS`
 * and a test checks that each chord it says works is really looked for in the file it names, so the two cannot
 * drift apart again.
 */
const AREA_BY_NUMBER: Readonly<Record<string, AreaId | undefined>> = Object.freeze({
  '1': 'play',
  '2': 'study',
  '3': 'library',
  '4': 'live'
})

/** Where you were last time, if it is still a real area. A stored name that no longer exists is ignored, not trusted. */
function rememberedArea(): AreaId {
  try {
    const saved = window.localStorage.getItem(WHERE_KEY)
    if (saved && ALL_AREAS.some((one) => one.id === saved)) return saved as AreaId
  } catch {
    // Private windows and cleared site data both throw here. Starting at Play is a fine answer.
  }
  return 'play'
}

export default function ChessView({ onClose, onNotify }: { onClose: () => void; onNotify: (text: string, kind?: NoticeKind) => void }): React.JSX.Element {
  const [area, setArea] = useState<AreaId>(rememberedArea)
  const [games, setGames] = useState<StoredGame[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [openPly, setOpenPly] = useState<number | undefined>(undefined)
  const [keysOpen, setKeysOpen] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setGames(await window.api.chessGames())
      setError(null)
    } catch (err) {
      // A list that could not be read is said so. It is never shown as an empty library, because "you have no games"
      // and "your games could not be read" are different sentences and only one of them is alarming.
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Your games could not be read.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // The board settings are a data attribute on the document element, so they reach every board on screen at once,
    // including the boards inside areas this file knows nothing about.
    applyStoredChessBoardSettings()
  }, [load])

  useEffect(() => {
    try {
      window.localStorage.setItem(WHERE_KEY, area)
    } catch {
      // Not remembering where you were is not worth an error.
    }
  }, [area])

  /*
   * The keys this shell can really answer.
   *
   * `?` opens the key list, the way it does elsewhere in Orbis. The four numbers and Shift+S move between areas,
   * which is the one thing the shell owns and no screen does.
   *
   * They are here because of what was found: the key sheet advertised fifteen chords on the Chess World screen and
   * named `ChessSettings.tsx` as the file that answered them, and that file has never had a key handler in it at
   * all. Pressing any of them did nothing, and the sheet said they worked -- the same shape of fault as a browser
   * chord that was registered nowhere. These five are the ones the shell can honour without reaching into another
   * screen's state. The rest are marked in the sheet as not answered yet, which is the honest half of the fix, and
   * `settings.test.ts` now fails if either half drifts.
   *
   * Never while something is being typed into, and never behind a dialog: a number key that moved the screen under
   * an open sheet would be worse than one that did nothing.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return
      if (event.key === '?') {
        event.preventDefault()
        setKeysOpen(true)
        return
      }
      if (document.querySelector('[aria-modal="true"]')) return
      const go = event.key === 'S' && event.shiftKey ? 'settings' : AREA_BY_NUMBER[event.key]
      if (!go) return
      event.preventDefault()
      setArea(go)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const open = useMemo(() => games.find((one) => one.id === openId) ?? null, [games, openId])

  /**
   * Open a game in the studio. Used by Play, Live, Famous games, the position editor and the position search.
   *
   * `ply` is what the position search found: it offers a button per move -- "24… Nf3" -- and this used to take only
   * an id, so TypeScript accepted the narrower function and dropped the move silently. Every one of those buttons
   * landed on move one.
   *
   * The games list is reloaded here and the reload is not waited for, which is why `openPly` and the three states
   * below exist: for a game created a moment ago the list is still the old one, so there is a render where the
   * studio has an id and cannot find the game. Saying "nothing is open" in that render -- straight after "the game
   * is in your Library" -- is what it used to do.
   */
  const study = useCallback((id: string, ply?: number): void => {
    setOpenId(id)
    setOpenPly(ply)
    setArea('study')
    void load()
  }, [load])

  /*
   * What Orbis itself may do here.
   *
   * The rail, as data: which area is open, which of them say what can be done inside them, and the one thing this
   * shell owns that an area does not -- opening one of your games in the Study screen. `chessSurfaces.ts` says what
   * each getter is for; the only rule worth repeating here is that `games` throws rather than answering with an
   * empty list, because "you have no games" and "your games could not be read" are different sentences.
   */
  useSurface(
    chessSurface({
      areas: ALL_AREAS,
      area: () => area,
      openArea: (id) => setArea(id as AreaId),
      games: () => {
        if (loading) throw new Error('Your games are still being read.')
        if (error !== null) throw new Error(error)
        return games.map((one) => ({ id: one.id, white: one.meta.white.name ?? null, black: one.meta.black.name ?? null, event: one.meta.event ?? null }))
      },
      openGame: () => openId,
      study,
      close: onClose
    })
  )

  const notify = onNotify
  const plainNotify = useCallback((text: string): void => onNotify(text), [onNotify])

  const body = ((): React.JSX.Element => {
    switch (area) {
      case 'play':
        return <ArenaGame onNotify={notify} onStudy={study} />
      case 'puzzles':
        return <PuzzleWorkspace onNotify={notify} />
      case 'endgames':
        return <EndgameLab onNotify={plainNotify} />
      case 'academy':
        return <Academy onNotify={notify} />
      case 'openings':
        return <OpeningLab onNotify={notify} />
      case 'famous':
        return <FamousGames onNotify={notify} onOpenInLibrary={study} library={games} />
      case 'calculation':
        return <CalculationGym onNotify={notify} />
      case 'blindfold':
        return <Blindfold onNotify={notify} />
      case 'drills':
        return <Drills onNotify={notify} />
      case 'vision':
        return <VisionTrainer onNotify={notify} />
      case 'coach':
        // `CoachArea` gathers the evidence from the games, the attempts and the recall records and hands it down.
        // `CoachPanel` underneath it still takes the evidence as a prop, so what it reports stays a property of what
        // was observed rather than of what this screen could find.
        return <CoachArea games={games} />
      case 'library':
        return <GameLibrary games={games} loading={loading} error={error} onReload={load} onOpen={study} openId={openId} onNotify={notify} />
      case 'study':
        // Four different things, and only the last of them is "you have not opened anything".
        if (open) return <AnalysisStudio game={open} atPly={openPly} onNotify={notify} />
        if (openId !== null && loading) return <p className="cw-loading" role="status">Opening the game…</p>
        if (openId !== null && error !== null) return <EmptyState>That game could not be read. {error}</EmptyState>
        if (openId !== null) return <EmptyState>That game is no longer in your Library.</EmptyState>
        return (
          <EmptyState>
            Nothing is open. Pick a game in the Library, play one, or set up a position.
          </EmptyState>
        )
      case 'review':
        // The same four answers the Study screen gives, for the same reason: this screen reviews one of your games,
        // so "nothing is open", "still being read", "could not be read" and "no longer there" are four different
        // sentences and only one of them is an empty screen.
        if (open) return <GameReview game={open} atPly={openPly} onNotify={notify} onOpenStudio={(ply) => study(open.id, ply)} />
        if (openId !== null && loading) return <p className="cw-loading" role="status">Opening the game…</p>
        if (openId !== null && error !== null) return <EmptyState>That game could not be read. {error}</EmptyState>
        if (openId !== null) return <EmptyState>That game is no longer in your Library.</EmptyState>
        return <EmptyState>Nothing is open. Pick a game in the Library and come back here.</EmptyState>
      case 'find':
        return <PositionSearch games={games} onOpen={study} onNotify={notify} />
      case 'live':
        return <LiveChess onNotify={notify} onStudy={study} />
      case 'editor':
        return <PositionEditor onNotify={notify} onOpened={(game) => study(game.id)} />
      case 'board3d':
        return <Board3DArea game={open} onNotify={plainNotify} />
      case 'reference':
        return <ReferencePanel onNotify={notify} />
      case 'settings':
        return <ChessSettings />
    }
  })()

  const here = ALL_AREAS.find((one) => one.id === area)
  /** Which group the area you are in belongs to, so the group tabs say where you are. */
  const group = GROUPS.find((one) => one.areas.some((each) => each.id === area)) ?? GROUPS[0]

  /*
   * Chess World takes the whole window.
   *
   * It used to wear the window's shared `Surface` frame, which is `position: absolute; inset: 0` inside `.stage` --
   * the column beside the Orbis sidebar. Measured there the screen was about 600px wide, a fixed 216px rail took a
   * third of that, and the board got what was left. So this is a fixed section over the whole window below the
   * title bar, which is what Files, Cosmos, Arena, F1 and Football already do; the way out is the arrow, and
   * Escape, which the window answers centrally for every feature screen.
   *
   * The rail went with it. Twenty names down the left is a column of width the board wants more: the five groups
   * are tabs along the top and the areas of the group you are in are a row under them, so the whole width below is
   * the area's.
   */
  return (
    <section className="cw-full" aria-label="Chess World">
      <header className="cw-bar">
        <button type="button" className="cw-back" onClick={onClose} title="Back to chat (Esc)" aria-label="Back to chat">
          <ArrowLeft size={16} />
        </button>
        <span className="cw-brand">CHESS WORLD</span>
        <nav className="cw-groups" aria-label="Chess World sections">
          {GROUPS.map((one) => (
            <button
              key={one.title}
              type="button"
              className={`cw-group-tab${group.title === one.title ? ' is-here' : ''}`}
              aria-current={group.title === one.title ? 'true' : undefined}
              onClick={() => setArea(one.areas[0].id)}
            >
              {one.title}
            </button>
          ))}
        </nav>
        <button type="button" className="cw-keys" onClick={() => setKeysOpen(true)} title="The keys (?)" aria-label="The keys">?</button>
      </header>

      <nav className="cw-areas" aria-label={group.title}>
        {group.areas.map((one) => (
          <button
            key={one.id}
            type="button"
            className={`cw-area-tab${area === one.id ? ' is-here' : ''}`}
            aria-current={area === one.id ? 'page' : undefined}
            title={one.blurb}
            onClick={() => setArea(one.id)}
          >
            {one.label}
          </button>
        ))}
      </nav>

      <section className="cw-area" aria-label={here?.label ?? 'Chess World'}>
        <Suspense fallback={<p className="cw-loading" role="status">Opening {here?.label ?? 'Chess World'}…</p>}>
          {body}
        </Suspense>
      </section>
      {keysOpen && (
        <Suspense fallback={<></>}>
          <ShortcutHelp onClose={() => setKeysOpen(false)} />
        </Suspense>
      )}
    </section>
  )
}
