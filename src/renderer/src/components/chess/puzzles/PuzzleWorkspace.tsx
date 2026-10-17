import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Chip, EmptyState, Segmented } from '../../../ui'
import type { NoticeKind } from '../../../lib/notices'
import { useSurface } from '../../../lib/surfaces'
import { puzzlesSurface } from '../chessSurfaces'
import type { Performance } from '../../../../../shared/chess/attempt'
import {
  RATING_BANDS, THEME_MEANING, addPuzzles, dailyFor, dailyStreak, dayKey,
  describePuzzleFilter, filterIsEmpty, filterPuzzles, missedPuzzles, puzzleFacets, puzzleLine, recentDays,
  recordAttempt, recordWords, solverOf, withoutPart,
  type Puzzle, type PuzzleFilter, type PuzzleStatus, type PuzzleTheme
} from '../../../../../shared/chess/puzzles'
import { RATING_MODEL, standingOf } from '../../../../../shared/chess/puzzleRating'
import { nextToSolve, nextWords, progressWords, solveProgress } from '../../../../../shared/chess/puzzleThemes'
import { previewFen, previewPuzzle } from '../../../../../shared/chess/puzzlePreview'
import type { RunRecord } from '../../../../../shared/chess/puzzleRun'
import { ChessStage } from '../ChessStage'
import { Maker } from './Maker'
import { Themes } from './Themes'
import { Rush } from './Rush'
import { Solver } from './Solver'
import { usePuzzleStore } from './store'
import './puzzles.css'

/**
 * Puzzle Universe: solving, making and going back over puzzles (Sections 071-080).
 *
 * ## There is no puzzle set, and that is said rather than hidden
 *
 * Orbis does not ship puzzles and does not fetch any. The puzzles somebody has are the ones made out of their own
 * saved games -- which is a real and rather good source, because a mate you missed in your own game is worth more
 * than a mate from a database. But an empty grid with a filter bar over it implies a library that is not there, so
 * when the collection is empty this screen says what the position actually is and offers the one thing that fills
 * it.
 *
 * ## The daily challenge is written down, not recomputed
 *
 * `dailyFor` picks by a hash of the local date the first time it is asked and records the answer. Afterwards it
 * reads the record. So the day's puzzle survives closing the app, and survives twenty more puzzles being made,
 * because nothing recomputes it. Everything about this is in `puzzles.ts`; this screen only has to remember to pass
 * the store it gets back along.
 *
 * ## Nothing claims more than it knows
 *
 * The rating line says "not enough yet" until there is enough, the model's formula and limits are on the screen
 * rather than in a comment, a theme Orbis checked is shown apart from one somebody merely said, and a puzzle made
 * from a game carries no rating at all.
 */

type Tab = 'solve' | 'themes' | 'daily' | 'rush' | 'make' | 'review'

const TABS: { value: Tab; label: string; name: string }[] = [
  { value: 'solve', label: 'Solve', name: 'Solve a puzzle from your collection' },
  { value: 'themes', label: 'Themes', name: 'The shelves: what kind of puzzle, and how far through each you are' },
  { value: 'daily', label: 'Today', name: 'Today’s challenge' },
  { value: 'rush', label: 'Run', name: 'A run against the clock, with three lives' },
  { value: 'make', label: 'Make', name: 'Make puzzles from your own games' },
  { value: 'review', label: 'Review', name: 'Go back over the ones you missed' }
]

/** The local day, kept up to date so a window left open overnight does not stay on yesterday. */
function useToday(): string {
  const [day, setDay] = useState(() => dayKey(Date.now(), new Date().getTimezoneOffset()))
  useEffect(() => {
    const timer = setInterval(() => setDay(dayKey(Date.now(), new Date().getTimezoneOffset())), 60_000)
    return () => clearInterval(timer)
  }, [])
  return day
}

export interface PuzzleWorkspaceProps {
  onNotify?: (text: string, kind?: NoticeKind) => void
}

export default function PuzzleWorkspace({ onNotify }: PuzzleWorkspaceProps): React.JSX.Element {
  const { store, runs, loading, readProblem, saveProblem, dropped, canKeep, carried, update, keepRun } = usePuzzleStore()
  const today = useToday()
  const [tab, setTab] = useState<Tab>('solve')
  const [filter, setFilter] = useState<PuzzleFilter>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const [showModel, setShowModel] = useState(false)
  // The puzzle the big board is showing while a list is on screen. Picking a row shows it here first; solving is a
  // separate, deliberate step, so a stray click on a list never throws the person straight into an attempt.
  const [previewId, setPreviewId] = useState<string | null>(null)

  const facets = useMemo(() => puzzleFacets(store), [store])
  const shown = useMemo(() => filterPuzzles(store, filter), [store, filter])
  const missed = useMemo(() => missedPuzzles(store), [store])
  const standing = useMemo(() => standingOf(store.person), [store.person])
  const streak = useMemo(() => dailyStreak(store, today), [store, today])
  const recent = useMemo(() => recentDays(store, today), [store, today])
  const progress = useMemo(() => solveProgress(store), [store])

  /*
   * Fixing the day's choice.
   *
   * This writes, so it is an effect and not something render works out. It only writes when there is a choice to
   * make and it has not been made: a day that is already recorded is read, and a day with nothing to choose from is
   * left alone rather than rewritten on every draw.
   */
  useEffect(() => {
    // Never while the collection is still being read: the day would be fixed against an empty collection and that
    // choice is written once and never changed.
    if (loading) return
    if (store.daily[today] !== undefined) return
    const chosen = dailyFor(store, today)
    if (chosen.puzzleId === null || chosen.wasFixed) return
    update(() => chosen.store)
  }, [loading, store, today, update])

  const daily = useMemo(() => dailyFor(store, today), [store, today])
  const dailyRecord = daily.puzzleId ? store.records[daily.puzzleId] : undefined
  const dailyDone = Boolean(dailyRecord?.attempts.some((one) => one.day === today))

  const finished = useCallback((performance: Performance, day?: string) => {
    const done = recordAttempt(store, performance, Date.now(), day)
    if (!done.ok) {
      onNotify?.(done.says, 'warn')
      return
    }
    update(() => done.store)
    onNotify?.(done.says)
  }, [store, update, onNotify])

  /*
   * An attempt made inside a run.
   *
   * The same record as any other attempt -- a run is not a different kind of solving, it is the same solving with a
   * clock on it -- but it says nothing on screen. A notice per puzzle in a run that may serve twenty of them would
   * bury the run itself. It changes the collection as it stands rather than as it was when this last drew, because
   * a run writes several times in quick succession.
   */
  const rushAttempt = useCallback((performance: Performance) => {
    update((current) => recordAttempt(current, performance, Date.now()).store)
  }, [update])

  const rushFinished = useCallback((record: RunRecord) => {
    keepRun(record)
    onNotify?.(`Run finished: ${record.score} ${record.score === 1 ? 'puzzle' : 'puzzles'}.`)
  }, [keepRun, onNotify])

  /*
   * On to the next one.
   *
   * Out of the list being looked at rather than the whole collection, so a shelf or a filter is worked through
   * rather than escaped from. `nextToSolve` picks an untried one before one that went wrong, and says which of the
   * two it picked, because being handed a puzzle you have already solved without being told is baffling.
   */
  const openNext = useCallback(() => {
    const picked = nextToSolve(store, shown, openId ?? undefined)
    if (!picked) {
      setOpenId(null)
      onNotify?.('That is everything in this list.')
      return
    }
    setOpenId(picked.puzzle.id)
    onNotify?.(nextWords(picked.kind))
  }, [store, shown, openId, onNotify])

  /** The same, over the ones waiting to be gone over, so Review walks its own list and not the whole collection. */
  const reviewNext = useCallback(() => {
    const picked = nextToSolve(store, missed.map((one) => one.puzzle), openId ?? undefined)
    if (!picked) {
      setOpenId(null)
      onNotify?.('Nothing else is waiting to be gone over.')
      return
    }
    setOpenId(picked.puzzle.id)
    onNotify?.(nextWords(picked.kind))
  }, [store, missed, openId, onNotify])

  const open = openId ? (store.puzzles.find((one) => one.id === openId) ?? null) : null

  /*
   * A list with the board beside it.
   *
   * The board shows the picked puzzle's real start position, not solved and not interactive, so a list is never a
   * page of text with nothing to look at. `right` is the list itself. When the pool is empty there is no position
   * to show, so the list is drawn alone and says so, rather than a board with nothing on it.
   */
  const listWithBoard = (pool: readonly Puzzle[], label: string, right: React.ReactNode): React.JSX.Element => {
    const pick = previewPuzzle(pool, previewId)
    if (!pick) return <div className="cw-pz-pane">{right}</div>
    return (
      <ChessStage
        className="cw-pz-listing"
        label={label}
        board={{
          fen: previewFen(pick),
          orientation: solverOf(pick),
          interactive: false,
          label: `Puzzle: ${pick.exercise.prompt}`
        }}
        above={<p className="cw-pz-ask cw-pz-preview-name">{pick.exercise.prompt}</p>}
        below={
          <div className="cw-pz-row">
            <Button size="small" kind="primary" onClick={() => {
              // Solving happens on the Solve or Review tab. From Make or Themes it moves to Solve, so the attempt is shown.
              if (tab !== 'solve' && tab !== 'review') setTab('solve')
              setPreviewId(pick.id)
              setOpenId(pick.id)
            }}>Solve this one</Button>
            <span className="cw-pz-faint">{puzzleLine(pick, store.records[pick.id])}</span>
          </div>
        }
        right={right}
      />
    )
  }

  const keepMade = useCallback((puzzles: Puzzle[]) => {
    update((current) => addPuzzles(current, puzzles).store)
  }, [update])

  const have = useMemo(() => new Set(store.puzzles.map((one) => one.id)), [store.puzzles])

  const toggleTheme = (theme: PuzzleTheme): void => {
    setFilter((held) => {
      const themes = new Set(held.themes ?? [])
      if (themes.has(theme)) themes.delete(theme)
      else themes.add(theme)
      return themes.size === 0 ? withoutPart(held, 'themes') : { ...held, themes: [...themes] }
    })
  }

  const toggleStatus = (status: PuzzleStatus): void => {
    setFilter((held) => {
      const all = new Set(held.status ?? [])
      if (all.has(status)) all.delete(status)
      else all.add(status)
      return all.size === 0 ? withoutPart(held, 'status') : { ...held, status: [...all] }
    })
  }

  /*
   * What Orbis itself may do here.
   *
   * Above the loading answer below, because a hook has to be: the collection is read from the profile, and while it
   * is being read every getter here throws rather than answering with a nought. Nought solved out of nought puzzles
   * is what somebody whose whole history had been lost would see, and it must not be said about a history that is
   * merely still arriving.
   */
  useSurface(
    puzzlesSurface({
      tab: () => tab,
      setTab: (value) => {
        setTab(value)
        setOpenId(null)
      },
      counts: () => {
        if (loading) throw new Error('Your puzzles are still being read.')
        if (readProblem) throw new Error(readProblem)
        return { puzzles: store.puzzles.length, solved: facets.statuses.find((one) => one.value === 'solved')?.count ?? 0, missed: missed.length }
      },
      standing: () => ({ says: standing.says, why: standing.why }),
      streak: () => streak.says,
      today: () => ({ says: daily.says, done: dailyDone }),
      open: () => openId,
      openPuzzle: setOpenId,
      ids: () => store.puzzles.map((one) => one.id)
    })
  )

  /*
   * The collection is in the profile now, so reading it takes a moment. Nothing of it is drawn in that moment: an
   * empty trainer with "Not tried yet" against every figure is what somebody would see if their whole history had
   * been lost, and showing that to a person whose history is fine is not a cost worth paying for one frame.
   */
  if (loading) {
    return (
      <section className="cw-pz" aria-label="Puzzles">
        <p className="cw-loading" role="status">Reading your puzzles…</p>
      </section>
    )
  }

  return (
    <section className="cw-pz" aria-label="Puzzles">
      {readProblem && (
        <p className="cw-pz-warn" role="status">
          {readProblem} Anything you do here will last only as long as this visit.
        </p>
      )}
      {saveProblem && <p className="cw-pz-warn" role="status">{saveProblem}</p>}
      {carried && <p className="cw-pz-warn" role="status">{carried}</p>}
      {dropped.length > 0 && (
        <details className="cw-pz-whynot">
          <summary>{dropped.length} {dropped.length === 1 ? 'thing' : 'things'} in your saved collection could not be read</summary>
          <ul>{dropped.map((one) => <li key={one}>{one}</li>)}</ul>
        </details>
      )}

      <header className="cw-pz-head">
        <div className="cw-pz-standing">
          <p className="cw-pz-rating">{standing.says}</p>
          <p className="cw-pz-faint">{standing.why}</p>
          <button type="button" className="cw-pz-link" onClick={() => setShowModel((on) => !on)} aria-expanded={showModel}>
            {showModel ? 'Hide how this is worked out' : 'How is this worked out?'}
          </button>
          {showModel && (
            <div className="cw-pz-model">
              <p><strong>{RATING_MODEL.name}.</strong> {RATING_MODEL.origin}</p>
              <ol>{RATING_MODEL.formula.map((one) => <li key={one}>{one}</li>)}</ol>
              <h5>What it cannot do</h5>
              <ul>{RATING_MODEL.limits.map((one) => <li key={one}>{one}</li>)}</ul>
            </div>
          )}
        </div>
        <div className="cw-pz-headright">
          <p className="cw-pz-streak">{streak.says}</p>
          <p className="cw-pz-faint">{progressWords(progress)}</p>
        </div>
      </header>

      <Segmented
        label="Puzzles"
        className="cw-pz-tabs"
        optionClass="cw-pz-tab"
        value={tab}
        options={TABS}
        onChange={(value) => { setTab(value); setOpenId(null) }}
      />

      {/* The run says its own thing about an empty collection: it has a floor of its own and explains it. */}
      {store.puzzles.length === 0 && tab !== 'make' && tab !== 'rush' && (
        <div className="cw-pz-none">
          <h3>There are no puzzles here yet</h3>
          <p>
            Orbis ships none and fetches none. Yours are made out of your own saved games — the positions where a
            forced mate really was on the board.
          </p>
          <p className="cw-pz-faint">That search needs no engine, so every puzzle it makes is checked before you see it.</p>
          <Button size="small" kind="primary" onClick={() => setTab('make')}>Make some from my games</Button>
        </div>
      )}

      {tab === 'solve' && store.puzzles.length > 0 && (
        <div className={`cw-pz-pane${open ? ' is-board' : ''}`}>
          {open
            ? (
              <>
                <div className="cw-pz-row">
                  <Button size="tiny" kind="quiet" onClick={() => setOpenId(null)}>Back to the list</Button>
                  <span className="cw-pz-faint">{shown.length} in this list</span>
                </div>
                <Solver
                  puzzle={open}
                  onFinished={finished}
                  onNext={openNext}
                  history={recordWords(store.records[open.id])}
                />
              </>
            )
            : listWithBoard(shown, 'Your puzzles', (
              <>
                <div className="cw-pz-filters">
                  {facets.themes.length > 0 && (
                    <div className="cw-pz-chips" role="group" aria-label="Filter by what the puzzle is about">
                      {facets.themes.map((one) => (
                        <Chip
                          key={one.value}
                          on={(filter.themes ?? []).includes(one.value as PuzzleTheme)}
                          title={THEME_MEANING[one.value as PuzzleTheme]}
                          onClick={() => toggleTheme(one.value as PuzzleTheme)}
                        >
                          {one.label} {one.count}
                        </Chip>
                      ))}
                    </div>
                  )}
                  {facets.statuses.length > 1 && (
                    <div className="cw-pz-chips" role="group" aria-label="Filter by how you have done">
                      {facets.statuses.map((one) => (
                        <Chip key={one.value} on={(filter.status ?? []).includes(one.value as PuzzleStatus)} onClick={() => toggleStatus(one.value as PuzzleStatus)}>
                          {one.label} {one.count}
                        </Chip>
                      ))}
                    </div>
                  )}
                  {facets.ratings.length > 0 && (
                    <div className="cw-pz-chips" role="group" aria-label="Filter by rating">
                      {facets.ratings.map((one) => {
                        const band = RATING_BANDS.find((row) => `${row.from}-${row.to}` === one.value)
                        const on = band !== undefined && filter.ratingFrom === band.from && filter.ratingTo === band.to
                        return (
                          <Chip
                            key={one.value}
                            on={on}
                            onClick={() => setFilter((held) => (on || !band ? withoutPart(held, 'ratingFrom') : { ...held, ratingFrom: band.from, ratingTo: band.to }))}
                          >
                            {one.label} {one.count}
                          </Chip>
                        )
                      })}
                      {facets.unrated > 0 && (
                        <span className="cw-pz-faint">
                          {facets.unrated} {facets.unrated === 1 ? 'has' : 'have'} no rating, because nothing has rated them.
                        </span>
                      )}
                    </div>
                  )}
                  {!filterIsEmpty(filter) && (
                    <p className="cw-pz-showing">
                      Showing {describePuzzleFilter(filter).map((one) => one.words).join(', ')}.
                      {' '}<button type="button" className="cw-pz-link" onClick={() => setFilter({})}>Show everything</button>
                    </p>
                  )}
                </div>

                {shown.length === 0
                  ? <EmptyState action={<Button size="small" onClick={() => setFilter({})}>Show everything</Button>}>
                      None of your {store.puzzles.length} {store.puzzles.length === 1 ? 'puzzle' : 'puzzles'} matches that.
                    </EmptyState>
                  : (
                    <ul className="cw-pz-list">
                      {shown.map((one) => (
                        <li key={one.id}>
                          <button type="button" className={`cw-pz-item${previewId === one.id ? ' is-picked' : ''}`} aria-pressed={previewId === one.id} onClick={() => setPreviewId(one.id)}>
                            <strong>{one.exercise.prompt}</strong>
                            <small>{puzzleLine(one, store.records[one.id])}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
              </>
              ))}
        </div>
      )}

      {tab === 'themes' && store.puzzles.length > 0 && (
        <div className="cw-pz-pane is-board">
          {listWithBoard(store.puzzles, 'Kinds of puzzle', (
            <Themes
              store={store}
              onOpen={(id) => { setOpenId(id); setTab('solve') }}
              onFilter={(theme) => { setFilter({ themes: [theme] }); setOpenId(null); setTab('solve') }}
              onMakePuzzles={() => setTab('make')}
              onPreview={(id) => setPreviewId(id)}
            />
          ))}
        </div>
      )}

      {tab === 'daily' && (
        <div className={`cw-pz-pane${daily.puzzle ? ' is-board' : ''}`}>
          <h3>Today — {today}</h3>
          <p className="cw-pz-faint">{daily.says}</p>
          {daily.puzzle
            ? (
              <>
                {dailyDone && (
                  <p className="cw-pz-says" role="status">
                    You have already had today’s go at this one. It stays today’s puzzle; there is nothing to reroll.
                    {' '}{recordWords(dailyRecord)}
                  </p>
                )}
                <Solver
                  key={`${daily.puzzle.id}-${today}-${dailyDone ? 'again' : 'first'}`}
                  puzzle={daily.puzzle}
                  day={dailyDone ? undefined : today}
                  onFinished={finished}
                  history={recordWords(dailyRecord)}
                />
              </>
            )
            : daily.gone
              ? <EmptyState>Today’s puzzle was chosen earlier and is no longer in your collection. The day is already settled, so nothing has been chosen in its place.</EmptyState>
              : <EmptyState action={<Button size="small" kind="primary" onClick={() => setTab('make')}>Make some from my games</Button>}>
                  There is nothing to choose from yet. Make a few puzzles out of your own games and today will have one.
                </EmptyState>}
          <ul className="cw-pz-days" aria-label="The last seven days">
            {[...recent].reverse().map((one) => (
              <li key={one.day} className={`is-${one.state}`} title={one.says}>
                <span aria-hidden="true">{one.state === 'done' ? '●' : one.state === 'missed' ? '○' : '·'}</span>
                <small>{one.day.slice(8)}</small>
              </li>
            ))}
          </ul>
          <p
            className="cw-pz-faint"
            title="A day counts when that day’s own puzzle was really solved — not when Orbis was opened, and not when the answer was shown. A small dot is a day nothing was chosen at all, which is not the same as having missed it."
          >
            {streak.says}
          </p>
        </div>
      )}

      {tab === 'rush' && (
        <div className="cw-pz-pane is-board">
          <Rush
            puzzles={store.puzzles}
            runs={runs}
            onAttempt={rushAttempt}
            onRunFinished={rushFinished}
            onMakePuzzles={() => setTab('make')}
          />
        </div>
      )}

      {tab === 'make' && (
        <div className="cw-pz-pane is-board">
          {listWithBoard(store.puzzles, 'Make puzzles', (
            <Maker onKeep={keepMade} have={have} onNotify={(text, kind) => onNotify?.(text, kind === 'error' ? 'error' : 'info')} />
          ))}
        </div>
      )}

      {tab === 'review' && (
        <div className={`cw-pz-pane${open ? ' is-board' : ''}`}>
          <h3>What went wrong</h3>
          {open
            ? (
              <>
                <div className="cw-pz-row">
                  <Button size="tiny" kind="quiet" onClick={() => setOpenId(null)}>Back to the list</Button>
                </div>
                <Solver puzzle={open} onFinished={finished} onNext={reviewNext} history={recordWords(store.records[open.id])} />
              </>
            )
            : missed.length === 0
              ? <EmptyState>
                  Nothing is waiting to be gone over. A puzzle lands here when the last go at it was not a solve —
                  one you have never tried is new material, which is not the same thing.
                </EmptyState>
              : listWithBoard(missed.map((one) => one.puzzle), 'Gone wrong', (
                <ul className="cw-pz-list">
                  {missed.map((one) => (
                    <li key={one.puzzle.id}>
                      <button type="button" className={`cw-pz-item${previewId === one.puzzle.id ? ' is-picked' : ''}`} aria-pressed={previewId === one.puzzle.id} onClick={() => setPreviewId(one.puzzle.id)}>
                        <strong>{one.puzzle.exercise.prompt}</strong>
                        <small>{one.says} {one.tries} {one.tries === 1 ? 'try' : 'tries'}{one.solvedBefore ? ', solved once before' : ''}.</small>
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
        </div>
      )}

      <footer className="cw-pz-foot">
        <p className="cw-pz-faint">
          {canKeep
            ? 'Your puzzles and how you have got on with them are kept with your profile, so they follow it to another machine and they travel in a profile export.'
            : 'Nothing here can be saved at the moment, so what you do now will last only as long as this visit. What is already saved has not been touched.'}
          {' '}{store.puzzles.length} {store.puzzles.length === 1 ? 'puzzle' : 'puzzles'}
          {facets.statuses.find((one) => one.value === 'solved') ? `, ${facets.statuses.find((one) => one.value === 'solved')?.count} solved` : ''}
          {missed.length ? `, ${missed.length} to go back over` : ''}.
        </p>
      </footer>
    </section>
  )
}

export { PuzzleWorkspace }
