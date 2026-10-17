import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Chip, EmptyState, SearchBox, Segmented } from '../../../ui'
import type { NoticeKind } from '../../../lib/notices'
import { ChessStage } from '../ChessStage'
import { MoveList, MoveNav } from '../MoveList'
import type { GameMeta, StoredGame } from '../../../../../shared/chess/model'
import { START_FEN, positionKey, type ChessMove } from '../../../../../shared/chess/rules'
import type { Mark } from '../../../../../shared/chess/marks'
import {
  COMMENTARY_IS, ENDING_LABEL, MATCH_IS_NOT_CORRECT, MODERN_ANALYSIS_IS, MOVES_ARE, PERIOD_LABEL,
  checkFamousGame, describeFamousFilter, famousFacets, famousLine, famousMovesToStore,
  famousPositions, famousTitle, famousToStored, filterFamous, filterIsEmpty, guidedFen, guidedPoint,
  guidedProgress, guidedSince, judgeGuided, periodOf, recordGuided, showGuided, startGuided, storedCopyOf,
  type FamousFilter, type FamousGame, type GuidedRun, type GuidedVerdict
} from '../../../../../shared/chess/famous'
import {
  FAMOUS_ORDERS, famousMoveNotes, isFamousOrder, orderFamous, orderWords, type FamousOrderId
} from '../../../../../shared/chess/famousOrder'
import { FAMOUS_COLLECTION_SAYS, FAMOUS_GAMES } from '../../../../../shared/chess/famousData'
import {
  checkRunSays, duplicateIdProblems, startCheckRun, tookGame, type CheckRun
} from '../../../../../shared/chess/famousCheckRun'
import './famous.css'
import { useSurface } from '../../../lib/surfaces'
import { simpleAreaSurface } from '../chessSurfaces'

/**
 * Famous games (Sections 231-240).
 *
 * Fifteen games that were really played: browsed, replayed, and copied into the Library when somebody wants to
 * study one properly.
 *
 * ## The board is never off this screen
 *
 * It used to be. Browsing the collection was a page of rows with no board on it at all, and the board only
 * appeared once you had opened a game -- and then at the shrink-to-fit size, beside a column of prose. So the
 * screen is one arrangement now and not two: the collection is a column on the left, the board is the middle of
 * the screen at whatever size the window allows, and the moves and the words about them are the column on the
 * right. Opening a different game changes what is on the board; it does not change the shape of the screen.
 * There is always a game open, because a collection of games with none of them on the board is a list.
 *
 * `ChessStage` decides how big the board is, by measuring. Nothing in this file has an opinion about it, which is
 * the point: this screen used to be one of the eight that let the board collapse.
 *
 * ## Three rules that have not changed
 *
 *   - **Every word of commentary says who wrote it.** Anything Orbis wrote sits in a block that says so. There is
 *     no unattributed prose anywhere, because an annotation with no author reads as though it came from the
 *     player.
 *   - **Nothing is counted that has not been counted.** The line saying the collection replays cleanly is
 *     produced by replaying it, here, now.
 *   - **A mark beside a move is never a judgement.** The only moves marked in the list are the ones the
 *     collection really has words about. No accuracy, no blunders, no engine numbers: this screen has no engine.
 *
 * Where the prose used to be a third tab of its own, it is a disclosure beside the board -- every word of it is
 * still there, and none of it is between you and the game.
 */

type Pane = 'replay' | 'guided'

const PANES: { value: Pane; label: string }[] = [
  { value: 'replay', label: 'Replay' },
  { value: 'guided', label: 'Find the move' }
]

/** The main process takes metadata as a plain bag of values. Spread into a literal so the typed shape fits through. */
const asBag = (meta: GameMeta): Record<string, unknown> => ({ ...meta })

/** One empty list, shared, so the board is not told its drawings changed on every redraw. */
const NOTHING_DRAWN: readonly Mark[] = Object.freeze([])

/**
 * The result of replaying all fifteen games, kept for as long as Orbis is open.
 *
 * `FAMOUS_GAMES` is frozen data, so replaying it a second time cannot give a different answer -- which is what makes
 * holding on to the figure honest. It is not a stored count: the first visit of a session still counts it by playing
 * every move through the rules, and if a game were ever wrong, that visit would say so.
 */
let countedOnce: CheckRun | null = null

export interface FamousGamesProps {
  /** Said to the person the way the rest of the window says things. */
  onNotify: (text: string, kind?: NoticeKind) => void
  /**
   * Called with the id of the game in the Library once a copy exists, so whichever screen owns the tabs can take
   * somebody to Study. Optional: without it the copy is still made and a notice says so.
   */
  onOpenInLibrary?: (libraryGameId: string) => void
  /**
   * The Library, when the parent already has it. Used only to notice that a copy is already there, so a second one
   * is not made. Left out, this screen asks for it itself.
   */
  library?: readonly StoredGame[]
}

export default function FamousGames({ onNotify, onOpenInLibrary, library }: FamousGamesProps): React.JSX.Element {
  const [filter, setFilter] = useState<FamousFilter>({})
  const [order, setOrder] = useState<FamousOrderId>('oldest')
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [pane, setPane] = useState<Pane>('replay')
  const [ply, setPly] = useState(0)
  const [orientation, setOrientation] = useState<'w' | 'b'>('w')
  const [busy, setBusy] = useState(false)
  const [own, setOwn] = useState<readonly StoredGame[]>([])
  const [drawings, setDrawings] = useState<Readonly<Record<string, readonly Mark[]>>>({})

  // The Library: the parent's copy when there is one, otherwise the one this screen fetched for itself.
  const libraryGames = library ?? own
  const refreshLibrary = useCallback(async () => {
    if (library) return
    try {
      setOwn(await window.api.chessGames())
    } catch {
      /*
       * Not being able to read the Library means this screen cannot tell whether a copy exists. It leaves the list
       * empty, which only costs the "In your Library" mark -- it never invents a copy that is not there.
       */
      setOwn([])
    }
  }, [library])

  useEffect(() => { void refreshLibrary() }, [refreshLibrary])

  /*
   * The whole collection, checked, one game at a time.
   *
   * The number shown is counted here by replaying every move through the rules; it is not a number written into the
   * data by hand, which could go stale the moment a game changed.
   *
   * It is done a game per timeout, and that is the whole point of the shape of this. Checking all fifteen in one
   * call takes about five seconds on this machine, and a timeout does not make work concurrent -- it only moves it
   * past the first paint. For those five seconds the window could not answer anything, so the order buttons and the
   * game rows looked dead: a click was taken and then sat in the queue for longer than anybody waits before
   * deciding a control does not work. A game at a time, the longest the window is ever busy is one game.
   *
   * The run is kept in `countedOnce`, outside the component, because the dependency array belongs to the component
   * and not to the module: leaving Famous games and coming back replayed all 861 moves again. The data is frozen, so
   * the answer cannot change within a session -- and that is the only reason a cache is honest here rather than a
   * way of showing a stale number.
   */
  const [checked, setChecked] = useState<CheckRun>(() => countedOnce ?? startCheckRun(FAMOUS_GAMES.length))
  useEffect(() => {
    if (countedOnce) return undefined
    let alive = true
    let id = 0
    let run = startCheckRun(FAMOUS_GAMES.length)
    // The one fault no single game's check can see, and it costs nothing, so it is found before any replaying.
    const duplicates = duplicateIdProblems(FAMOUS_GAMES.map((game) => game.id))
    run = { ...run, problems: duplicates }
    const nextGame = (at: number): void => {
      const game = FAMOUS_GAMES[at]
      if (!game) return
      run = tookGame(run, checkFamousGame(game))
      if (!alive) return
      setChecked(run)
      if (run.done) {
        countedOnce = run
        return
      }
      id = window.setTimeout(() => nextGame(at + 1), 0)
    }
    id = window.setTimeout(() => nextGame(0), 0)
    return () => { alive = false; window.clearTimeout(id) }
  }, [])

  const facets = useMemo(() => famousFacets(FAMOUS_GAMES), [])
  const shown = useMemo(() => orderFamous(filterFamous(FAMOUS_GAMES, filter), order), [filter, order])

  /*
   * Which game is on the board.
   *
   * The one that was picked, and the first of the list when nothing has been picked yet -- so the board has a real
   * game on it the moment the screen opens. A game that is open stays open when a filter stops matching it: the
   * filter says what to list, not what to take off the board.
   */
  const open: FamousGame | null = useMemo(
    () => FAMOUS_GAMES.find((game) => game.id === pickedId) ?? shown[0] ?? FAMOUS_GAMES[0] ?? null,
    [pickedId, shown]
  )

  const positions = useMemo(() => (open ? famousPositions(open) : [START_FEN]), [open])
  const moves = useMemo(() => (open ? famousMovesToStore(open) : []), [open])
  const notes = useMemo(() => (open ? famousMoveNotes(open) : {}), [open])
  const here = open ? Math.max(0, Math.min(ply, open.san.length)) : 0
  const lastMove = here > 0 ? moves[here - 1] : undefined

  // A different game starts at its own first move, facing the way the collection is written.
  useEffect(() => {
    setPly(0)
    setOrientation('w')
  }, [open?.id])

  const pick = useCallback((game: FamousGame): void => {
    setPickedId(game.id)
    setPane('replay')
  }, [])

  // ---- copying one into the Library

  const existingCopy = open ? storedCopyOf(libraryGames, open.id) : null

  const copyToLibrary = async (game: FamousGame): Promise<void> => {
    const already = storedCopyOf(libraryGames, game.id)
    if (already) {
      onOpenInLibrary?.(already)
      onNotify('That game is already in your Library.')
      return
    }
    const written = famousMovesToStore(game)
    if (!written.length) {
      // Cannot happen while the test passes. If it ever did, nothing half-made would be saved.
      onNotify('That game will not replay, so Orbis has not copied it.', 'error')
      return
    }
    setBusy(true)
    try {
      const payload = famousToStored(game)
      const made = await window.api.chessCreate({ source: payload.source, startFen: payload.startFen, meta: asBag(payload.meta) })
      await window.api.chessSaveMoves(made.id, written, asBag(payload.meta))
      // The tag is what marks the copy as one of these, and it is set separately because that is the only call
      // that takes tags.
      await window.api.chessUpdate(made.id, { tags: payload.tags })
      await refreshLibrary()
      onNotify(`${famousTitle(game)} is in your Library.`)
      onOpenInLibrary?.(made.id)
    } catch (err) {
      onNotify(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'That did not work.', 'error')
    } finally {
      setBusy(false)
    }
  }

  // ---- the guided mode

  const [run, setRun] = useState<GuidedRun | null>(null)
  const [verdict, setVerdict] = useState<GuidedVerdict | null>(null)
  const [revealed, setRevealed] = useState(false)
  /** True when the move was shown rather than found. Kept apart, because what is recorded depends on it. */
  const [wasShown, setWasShown] = useState(false)
  const [typed, setTyped] = useState('')

  const startRun = useCallback((game: FamousGame): void => {
    setRun(startGuided(game))
    setVerdict(null)
    setRevealed(false)
    setWasShown(false)
    setTyped('')
  }, [])

  // Opening a different game, or leaving this pane, starts again rather than carrying half a run over.
  useEffect(() => {
    if (open && pane === 'guided') startRun(open)
    else {
      setRun(null)
      setVerdict(null)
      setRevealed(false)
      setWasShown(false)
    }
  }, [open, pane, startRun])

  const point = open && run ? guidedPoint(open, run) : null
  const guessFen = open && point ? guidedFen(open, point) : START_FEN
  const afterGuess = point ? positions[point.ply] ?? guessFen : guessFen
  const progress = open && run ? guidedProgress(open, run) : null
  const since = open && run ? guidedSince(open, run) : null

  const guess = (written: string): void => {
    if (!open || !point) return
    const judged = judgeGuided(open, point, written)
    setVerdict(judged)
    // An illegal move reveals nothing: it is not an answer, so there is nothing to move on from.
    if (judged.legal) setRevealed(true)
  }

  const revealMove = (): void => {
    setVerdict(null)
    setRevealed(true)
    setWasShown(true)
    setTyped('')
  }

  const nextPoint = (): void => {
    if (!open || !run || !point) return
    setRun(wasShown
      ? showGuided(open, run)
      : recordGuided(open, run, { ply: point.ply, guess: verdict?.guess ?? null, matched: verdict?.matched ?? false, shown: false }))
    setVerdict(null)
    setRevealed(false)
    setWasShown(false)
    setTyped('')
  }

  // ---- what is on the board right now

  const boardFen = pane === 'guided' && point
    ? (revealed ? afterGuess : guessFen)
    : positions[here] ?? START_FEN

  /*
   * The arrows and coloured squares somebody draws while looking at the game.
   *
   * Kept against the position, so stepping back and forth keeps each position's own drawings, and held only while
   * the screen is open: this screen writes nothing to the profile and does not pretend to.
   */
  const drawingKey = positionKey(boardFen)
  const drawnHere = drawings[drawingKey] ?? NOTHING_DRAWN
  const onDraw = useCallback((next: Mark[]): void => {
    setDrawings((was) => ({ ...was, [drawingKey]: next }))
  }, [drawingKey])

  const step = (to: number): void => { if (open) setPly(Math.max(0, Math.min(open.san.length, to))) }

  const chipFor = <T extends string>(
    value: T,
    current: T | undefined,
    set: (next: T | undefined) => void,
    label: string,
    count: number
  ): React.JSX.Element => (
    <Chip key={`${label}-${String(value)}`} on={current === value} onClick={() => set(current === value ? undefined : value)}>
      {label} <span className="cw-fm-count">{count}</span>
    </Chip>
  )

  const band = open ? periodOf(open.year) : null
  const commentary = open && here > 0 ? open.guided.find((one) => one.ply === here) ?? null : null

  /* What Orbis itself may do here: which game is on the board, which pane, the order, and which way up. */
  useSurface(
    simpleAreaSurface({
      id: 'famous',
      name: 'Famous games',
      about: 'Games that were really played, move by move, with where each one comes from said out loud.',
      keywords: ['famous', 'games', 'classics', 'replay', 'provenance', 'history'],
      controls: {
        pane: {
          name: 'What to show',
          spec: { type: 'string', description: PANES.map((one) => `${one.value} is ${one.label}`).join('; '), enum: PANES.map((one) => one.value) },
          get: () => pane,
          set: (value) => setPane(String(value) === 'guided' ? 'guided' : 'replay'),
          default: 'replay'
        },
        order: {
          name: 'The order the collection is listed in',
          spec: { type: 'string', description: FAMOUS_ORDERS.map((one) => `${one.id} is ${one.label}`).join('; '), enum: FAMOUS_ORDERS.map((one) => one.id) },
          get: () => order,
          // A name that is not one of the orders is refused rather than silently reordering the list.
          set: (value) => { if (isFamousOrder(value)) setOrder(value) },
          default: 'oldest'
        },
        orientation: {
          name: 'Which way up the board is',
          spec: { type: 'string', description: 'Whose pieces are at the bottom: w or b.', enum: ['w', 'b'] },
          get: () => orientation,
          set: (value) => setOrientation(String(value) === 'b' ? 'b' : 'w')
        }
      },
      state: () => ({
        pane,
        order,
        open: open?.id ?? null,
        move: ply,
        // How many of the games have been played out against the rules, which is a fact about the collection. While
        // the run is still going this says so, rather than reporting a figure for games nothing has replayed yet.
        checked: checked.done ? `${checked.verified} of ${checked.total}` : `still replaying: ${checked.at} of ${checked.total} so far`
      })
    })
  )

  if (!open) {
    // The collection is compiled into the program, so this cannot happen. It says so rather than drawing a board.
    return <EmptyState>The collection of famous games is not in this build, so there is nothing to show.</EmptyState>
  }

  const collection = (
    <div className="cw-fm-browse">
      <SearchBox
        value={filter.text ?? ''}
        onChange={(text) => setFilter((f) => ({ ...f, text }))}
        label="Search the collection"
        placeholder="A player, a place, a year"
        small
      />
      <Segmented
        value={order}
        options={FAMOUS_ORDERS.map((one) => ({ value: one.id, label: one.label }))}
        onChange={setOrder}
        label="The order"
        className="cw-fm-orders"
        optionClass="cw-fm-order"
        litClass="on"
      />
      <p className="cw-fm-orderwords" role="status">{orderWords(order)}</p>

      <details className="cw-fm-facets">
        <summary>Narrow it down</summary>
        <div className="cw-fm-facet" role="group" aria-label="Filter by when it was played">
          <span className="cw-fm-facet-name">When</span>
          {facets.periods.map((one) => chipFor(one.value, filter.period, (period) => setFilter((f) => ({ ...f, period })), one.label, one.count))}
        </div>
        <div className="cw-fm-facet" role="group" aria-label="Filter by what the game is remembered for">
          <span className="cw-fm-facet-name">What happens</span>
          {facets.themes.map((one) => chipFor(one.value, filter.theme, (theme) => setFilter((f) => ({ ...f, theme })), one.label, one.count))}
        </div>
        <div className="cw-fm-facet" role="group" aria-label="Filter by result">
          <span className="cw-fm-facet-name">Result</span>
          {facets.results.map((one) => chipFor(one.value, filter.result, (result) => setFilter((f) => ({ ...f, result })), one.label, one.count))}
        </div>
        <div className="cw-fm-facet" role="group" aria-label="Filter by player">
          <span className="cw-fm-facet-name">Player</span>
          {facets.players.map((one) => chipFor(one.value, filter.player, (player) => setFilter((f) => ({ ...f, player })), one.label, one.count))}
        </div>
      </details>

      <p className="cw-fm-did" role="status">
        {shown.length === FAMOUS_GAMES.length ? `${shown.length} games.` : `${shown.length} of ${FAMOUS_GAMES.length}. ${describeFamousFilter(filter)}`}
        {filterIsEmpty(filter) ? null : (
          <Button size="tiny" kind="quiet" className="cw-fm-clear" onClick={() => setFilter({})}>Clear</Button>
        )}
      </p>

      {shown.length === 0 ? (
        <EmptyState action={<Button size="small" onClick={() => setFilter({})}>Show the whole collection</Button>}>
          Nothing matches that. The collection is small on purpose — {FAMOUS_GAMES.length} games.
        </EmptyState>
      ) : (
        <ul className="cw-fm-list">
          {shown.map((game) => (
            <li key={game.id}>
              <button
                type="button"
                className={`cw-fm-item${game.id === open.id ? ' is-open' : ''}`}
                aria-current={game.id === open.id ? 'true' : undefined}
                onClick={() => pick(game)}
              >
                <strong className="cw-fm-item-name">
                  {famousTitle(game)}
                  {game.nickname ? <em className="cw-fm-nick">{game.nickname}</em> : null}
                </strong>
                <small className="cw-fm-item-line">
                  {famousLine(game)} · {game.san.length} moves
                  {storedCopyOf(libraryGames, game.id) ? ' · in your Library' : ''}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  const above = (
    <div className="cw-fm-head">
      <div className="cw-fm-headwords">
        <h3 className="cw-fm-title">
          {famousTitle(open)}
          {open.nickname ? <em className="cw-fm-nick">{open.nickname}</em> : null}
        </h3>
        <p className="cw-fm-line">
          {[
            open.event,
            famousLine(open),
            ENDING_LABEL[open.ending],
            open.round ? `round ${open.round}` : '',
            band ? PERIOD_LABEL[band] : ''
          ].filter((part) => part !== '' && part !== undefined).join(' · ')}
        </p>
      </div>
      <Segmented
        value={pane}
        options={PANES}
        onChange={setPane}
        label="What to do with this game"
        className="cw-fm-panes"
        optionClass="cw-fm-pane"
        litClass="on"
      />
    </div>
  )

  const below = pane === 'guided'
    ? (
      <p className="cw-fm-under" role="status">
        {point
          ? 'Play the move you think was played, or type it on the right.'
          : 'Every marked move in this game has been asked about.'}
      </p>
    )
    : (
      <MoveNav
        ply={here}
        total={open.san.length}
        onJump={step}
        onFlip={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))}
      >
        <span className="cw-fm-result">{open.result}</span>
      </MoveNav>
    )

  const replayPanel = (
    <>
      <MoveList
        moves={open.san}
        ply={here}
        onJump={step}
        notes={notes}
        className="cw-fm-moves"
        empty="This game has no moves recorded."
      />
      <div className="cw-fm-ours">
        <p className="cw-fm-ours-who">Orbis’s own words</p>
        <p className="cw-fm-ours-text">{commentary ? commentary.afterward : open.note}</p>
        {commentary ? <p className="cw-fm-ours-at">About {open.san[here - 1]}, the move on the board.</p> : null}
      </div>
      <Button size="small" kind="primary" busy={busy} busyLabel="Copying…" onClick={() => void copyToLibrary(open)}>
        {existingCopy ? 'Open it in the Library' : 'Put a copy in the Library'}
      </Button>
      <details className="cw-fm-prov">
        <summary>Where this game comes from, and what Orbis does not claim</summary>
        <h5 className="cw-fm-prov-head">The moves</h5>
        <p className="cw-fm-prov-text">{MOVES_ARE}</p>
        <h5 className="cw-fm-prov-head">The words</h5>
        <p className="cw-fm-prov-text">{COMMENTARY_IS}</p>
        <h5 className="cw-fm-prov-head">What an engine would be saying</h5>
        <p className="cw-fm-prov-text">{MODERN_ANALYSIS_IS}</p>
        <p className="cw-fm-prov-text">
          This screen shows no engine numbers at all. Put a copy in your Library and ask the engine there, where
          anything it says is shown as analysis rather than as part of the game.
        </p>
        <h5 className="cw-fm-prov-head">What Orbis does not claim about this game</h5>
        <ul className="cw-fm-prov-list">
          {open.unstated.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <h5 className="cw-fm-prov-head">Checked against the rules</h5>
        <GameCheck game={open} />
      </details>
    </>
  )

  const guidedPanel = run ? (
    <>
      {point ? (
        <div className="cw-fm-ask">
          <p className="cw-fm-ask-head">
            Move {Math.ceil(point.ply / 2)}{point.ply % 2 === 1 ? ', White to play' : ', Black to play'}
          </p>
          {since && since.written ? (
            <p className="cw-fm-since">
              <span className="cw-fm-since-name">{since.from === 0 ? 'The game so far' : 'Since the last question'}</span>
              <span className="cw-fm-since-moves">{since.written}</span>
            </p>
          ) : null}
          <div className="cw-fm-ours">
            <p className="cw-fm-ours-who">Orbis asks</p>
            <p className="cw-fm-ours-text">{point.ask}</p>
          </div>
          {revealed ? null : (
            <form className="cw-fm-typed" onSubmit={(event) => { event.preventDefault(); if (typed.trim()) guess(typed) }}>
              <input
                className="cw-fm-input"
                aria-label="The move you think was played"
                placeholder="Nf3 or g1f3"
                value={typed}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setTyped(event.target.value)}
              />
              <Button size="tiny" type="submit" disabled={!typed.trim()}>Say it</Button>
              <Button size="tiny" kind="quiet" onClick={revealMove}>Show me</Button>
            </form>
          )}

          {verdict ? (
            <p
              className={`cw-fm-verdict${verdict.matched ? ' is-match' : verdict.legal ? ' is-other' : ' is-illegal'}`}
              role="status"
            >
              {verdict.says}
            </p>
          ) : null}

          {revealed ? (
            <>
              <p className="cw-fm-played">
                {wasShown ? 'Shown, not found. ' : ''}The game went <strong>{open.san[point.ply - 1]}</strong>.
              </p>
              <div className="cw-fm-ours">
                <p className="cw-fm-ours-who">Orbis’s own words</p>
                <p className="cw-fm-ours-text">{point.afterward}</p>
              </div>
              <Button size="small" kind="primary" onClick={nextPoint}>
                {run.answers.length + 1 >= open.guided.length ? 'Finish' : 'Next'}
              </Button>
            </>
          ) : null}
        </div>
      ) : (
        <EmptyState action={<Button size="small" onClick={() => startRun(open)}>Go through them again</Button>}>
          {progress?.says ?? 'There is nothing marked in this game.'}
        </EmptyState>
      )}
      {progress && progress.points > 0 ? (
        <p className="cw-fm-progress" role="status">
          {progress.answered} of {progress.points} answered. {progress.matched} matched the game
          {progress.shown > 0 ? `, ${progress.shown} shown` : ''}.
        </p>
      ) : null}
      <p className="cw-fm-caveat">{MATCH_IS_NOT_CORRECT}</p>
    </>
  ) : null

  return (
    <div className="cw-fm-root">
      <ChessStage
        className="cw-fm-stage"
        label={pane === 'guided' ? 'Find the move that was played' : 'The game on the board'}
        board={{
          fen: boardFen,
          orientation,
          interactive: pane === 'guided' && Boolean(point) && !revealed,
          lastMove: pane === 'guided' ? null : lastMove ? { from: lastMove.uci.slice(0, 2), to: lastMove.uci.slice(2, 4) } : null,
          ...(pane === 'guided' ? { onMove: (move: ChessMove) => guess(move.uci) } : {}),
          marks: drawnHere,
          onMarksChange: onDraw,
          label: pane === 'guided' ? 'Find the move that was played' : 'The game'
        }}
        above={above}
        below={below}
        left={collection}
        right={pane === 'guided' ? guidedPanel : replayPanel}
      />
      {/*
        * What the collection is and whether it really replays, under everything else.
        *
        * It used to be three paragraphs above the games. It is one line here, because it is a fact about the
        * collection and not a thing anybody came to read -- and it still says the truth while the replaying is
        * going on rather than claiming all fifteen before any of them have been checked.
        */}
      <footer className="cw-fm-foot">
        <p className="cw-fm-checked" role="status">
          {checkRunSays(checked)}
          {checked.done && checked.verified === checked.total
            ? ' Every move legal, every ending consistent with the final position.'
            : ''}
        </p>
        <details className="cw-fm-says">
          <summary>What this collection is</summary>
          <p className="cw-fm-says-text">{FAMOUS_COLLECTION_SAYS}</p>
        </details>
        {checked.problems.length > 0 && (
          <details className="cw-fm-checkfaults">
            <summary>{checked.problems.length} {checked.problems.length === 1 ? 'thing' : 'things'} wrong in the collection itself</summary>
            <ul>
              {checked.problems.map((one, index) => <li key={`fault-${index}`}>{one.message}</li>)}
            </ul>
          </details>
        )}
      </footer>
    </div>
  )
}

/**
 * One game, checked, now.
 *
 * Not a stored result and not a claim written into the data: the moves are replayed while this is on screen and
 * what is printed is what came back. A game that failed would say so here rather than quietly looking fine.
 */
function GameCheck({ game }: { game: FamousGame }): React.JSX.Element {
  const check = useMemo(() => checkFamousGame(game), [game])
  if (check.ok) {
    return (
      <p className="cw-fm-prov-text cw-fm-ok">
        {check.moves} moves replayed from the ordinary starting position. Every one is legal, every one is written the
        way the rules write it, and the end of the game agrees with the position it finishes in.
      </p>
    )
  }
  return (
    <div className="cw-fm-bad">
      <p className="cw-fm-prov-text">This game did not come through the check. What is wrong with it:</p>
      <ul className="cw-fm-prov-list">
        {check.problems.map((problem) => <li key={problem.code + problem.message}>{problem.message}</li>)}
      </ul>
    </div>
  )
}
