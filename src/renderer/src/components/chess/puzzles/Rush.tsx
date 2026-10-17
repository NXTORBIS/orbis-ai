import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, EmptyState } from '../../../ui'
import { useSurface } from '../../../lib/surfaces'
import { puzzleRunSurface } from '../chessSurfaces'
import { ChessStage } from '../ChessStage'
import {
  advance, newAttempt, performanceOf, playMove, opponentReply,
  type AttemptSession, type Performance
} from '../../../../../shared/chess/attempt'
import { solverOf, type Puzzle } from '../../../../../shared/chess/puzzles'
import {
  COUNTED_WEIGHTS, END_WORDS, MODE_LABEL, RUN_LIVES, RUN_MODES, isRunning, ladderFor, limitMs, modeStanding,
  recordMissed, recordSolved, recordWordsFor, remainingMs, runRecordOf, settleRun, skipPuzzle, startRun, stopRun,
  type Run, type RunMode, type RunRecord
} from '../../../../../shared/chess/puzzleRun'

/**
 * Puzzle Rush: three minutes, five minutes, or until the lives are gone.
 *
 * A mode inside the puzzle workspace rather than a screen of its own, because it is the same puzzles, the same
 * collection and the same record -- what is different is that there is a clock on it and only three lives. There is
 * no race against another person: that is multiplayer and Orbis has none.
 *
 * ## What this screen is careful about
 *
 * **The clock is asked, never counted.** `remainingMs(run, Date.now())` works it out from the moment the run
 * started, so a window that was not drawn for four seconds comes back to the right clock. The redraw below exists
 * only to put the number on screen; it is not where the time lives, and `settleRun` ends the run at the moment the
 * clock really ran out rather than at the moment this component noticed.
 *
 * **A solve that arrives after the clock has gone is not counted, and is said so.** `recordSolved` settles first
 * and refuses, with words. That is the case a counter-driven clock gets wrong every time.
 *
 * **The climb says what it is.** `ladderFor` orders the run by rating when there are enough rated puzzles and by
 * things counted off the board when there are not -- and no puzzle Orbis makes has a rating, so in practice it is
 * the counted order, which this screen names as a convention of Orbis's rather than calling it a difficulty.
 *
 * **A broken puzzle does not cost a life.** A puzzle with no reply recorded for the opponent cannot be finished,
 * which is a gap in the puzzle and not a mistake by the person solving it. It is skipped, said out loud, and the
 * lives are untouched.
 */

/** The position on the board, ready to take a move, in one step. A rush has nothing to wait for. */
function readyAttempt(puzzle: Puzzle, go: string, now: number): AttemptSession {
  let session = newAttempt({ id: `${puzzle.id}-${go}`, exercise: puzzle.exercise, now })
  const loading = advance(session, { kind: 'load' }, now)
  if (loading.ok) session = loading.session
  const active = advance(session, { kind: 'loaded' }, now)
  if (active.ok) session = active.session
  return session
}

/** Past whatever is being explained, at once. A rush does not stop to explain. */
function pastFeedback(session: AttemptSession, now: number): AttemptSession {
  let held = session
  for (let step = 0; step < 4 && held.state === 'awaiting-feedback'; step++) {
    const next = advance(held, { kind: 'feedback-done' }, now)
    if (!next.ok) break
    held = next.session
  }
  return held
}

/**
 * The attempt ended as not solved -- a wrong move, which is not the same as asking to see the answer.
 *
 * `give-up` is the only step the machine has from here to a final state; the outcome is then put right, because
 * `given-up` means the answer was asked for and a wrong move is not that. `performanceOf` reads the outcome, so
 * leaving it would record every wrong move as somebody having asked to see it.
 */
function endAsMissed(session: AttemptSession, now: number, why: string): AttemptSession {
  const stopped = advance(session, { kind: 'give-up' }, now)
  if (!stopped.ok) return session
  return { ...stopped.session, outcome: 'failed', why }
}

const FINISHED = ['completed', 'failed', 'abandoned']

export interface RushProps {
  /** Everything in the collection. The run picks its own pool out of this. */
  puzzles: readonly Puzzle[]
  /** Finished runs, oldest first, for the best score in each mode. */
  runs: readonly RunRecord[]
  /** One finished attempt at one puzzle, recorded into the collection the way any other attempt is. */
  onAttempt: (performance: Performance) => void
  /** One finished run, kept in the profile. */
  onRunFinished: (record: RunRecord) => void
  /** Offered when there is nothing to run through yet. */
  onMakePuzzles?: () => void
}

export function Rush({ puzzles, runs, onAttempt, onRunFinished, onMakePuzzles }: RushProps): React.JSX.Element {
  const [run, setRun] = useState<Run | null>(null)
  const [session, setSession] = useState<AttemptSession | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [showCounting, setShowCounting] = useState(false)
  const kept = useRef<string | null>(null)
  const scored = useRef<string | null>(null)
  /** What to put in front of the run's own sentence when a puzzle went wrong. */
  const why = useRef<string | null>(null)

  const ladder = useMemo(() => ladderFor(puzzles), [puzzles])
  const byId = useMemo(() => new Map(puzzles.map((one) => [one.id, one])), [puzzles])
  const standings = useMemo(() => RUN_MODES.map((mode) => modeStanding(runs, mode.id)), [runs])

  const running = run !== null && isRunning(run)
  const onScreen = run && running && run.at < run.order.length ? (byId.get(run.order[run.at]) ?? null) : null

  /*
   * One redraw a second, only to put the clock on screen.
   *
   * It does not hold the time and it cannot be the thing that ends the run: `settleRun` below works the ending out
   * from the moment the run started, so a redraw that never arrives costs a stale number on screen and nothing else.
   */
  useEffect(() => {
    if (!running || run === null || limitMs(run.mode) === null) return
    const timer = setInterval(() => setTick((one) => one + 1), 250)
    return () => clearInterval(timer)
  }, [running, run])

  // The clock, asked rather than counted. A run whose time has gone ends here, at the moment it really went.
  useEffect(() => {
    if (!running || run === null) return
    const settled = settleRun(run, Date.now())
    if (settled !== run) setRun(settled)
  }, [running, run, tick])

  // A fresh position whenever the run moves on to the next puzzle.
  useEffect(() => {
    if (!run || !running) return
    if (onScreen === null) return
    setSession(readyAttempt(onScreen, `${run.id}-${run.at}`, Date.now()))
  }, [run?.id, run?.at, running, onScreen?.id])

  /*
   * One puzzle finished: the point or the life, and the attempt recorded in the collection.
   *
   * In one place rather than at each of the four ways a puzzle can end, and in particular not only where a move is
   * played. A line that ends on the *opponent's* move finishes in the effect below, with nobody having played
   * anything -- and when this lived in the move handler, those puzzles were solved on screen and scored nothing.
   */
  useEffect(() => {
    if (!run || !running || !session || !onScreen) return
    if (!FINISHED.includes(session.state)) return
    if (scored.current === session.id) return
    scored.current = session.id
    const now = Date.now()
    onAttempt(performanceOf(session, onScreen.exercise, now))
    const step = session.outcome === 'solved'
      ? recordSolved(run, now)
      : recordMissed(run, session.outcome === 'given-up' ? 'shown' : 'wrong', now)
    setRun(step.run)
    setNote(why.current ? `${why.current} ${step.says}` : step.says)
    why.current = null
  }, [run, running, session, onScreen, onAttempt])

  // The opponent's reply, from the puzzle's own recorded defences, after a beat so it can be seen.
  useEffect(() => {
    if (!session || session.state !== 'awaiting-opponent' || !onScreen) return
    const timer = setTimeout(() => {
      const reply = opponentReply(onScreen.exercise, session.played.map((one) => one.uci))
      if (!reply) {
        // A gap in the puzzle. Not a mistake by the person solving it, so it costs nothing.
        setNote('That puzzle has no reply recorded for the other side, so it cannot be finished. It is a gap in the puzzle, not a mistake by you, and it has not cost you a life.')
        setRun((held) => (held ? skipPuzzle(held, Date.now()).run : held))
        return
      }
      const moved = advance(session, { kind: 'opponent-moved', move: reply, exercise: onScreen.exercise }, Date.now())
      if (moved.ok) setSession(pastFeedback(moved.session, Date.now()))
    }, 260)
    return () => clearTimeout(timer)
  }, [session, onScreen])

  // The record of a finished run goes out once.
  useEffect(() => {
    if (!run || isRunning(run)) return
    if (kept.current === run.id) return
    const record = runRecordOf(run)
    if (!record) return
    kept.current = run.id
    onRunFinished(record)
  }, [run, onRunFinished])

  const begin = useCallback((mode: RunMode) => {
    const now = Date.now()
    const started = startRun({ mode: mode.id, puzzles, now })
    if (!started.ok || !started.run) {
      setNote(started.says)
      return
    }
    kept.current = null
    scored.current = null
    why.current = null
    setNote(null)
    setSession(null)
    setRun(started.run)
  }, [puzzles])

  /*
   * A move.
   *
   * All this does is drive the attempt. Whether it was worth a point or a life is the effect above, which is the
   * only place that decides -- so there is one answer to that question however the puzzle ended.
   */
  const move = (uci: string): void => {
    if (!run || !running || !session || !onScreen || session.state !== 'active') return
    const now = Date.now()
    const played = playMove(session, onScreen.exercise, uci, now)
    if (!played.ok) return

    if (played.verdict.kind === 'illegal') {
      // The board only offers legal moves, so this is all but unreachable. It costs nothing either way: a move that
      // cannot be played is a rules problem and is never reported as a chess mistake.
      setSession(played.session)
      setNote(played.verdict.says)
      return
    }

    if (played.verdict.kind === 'not-the-idea') {
      why.current = played.verdict.says
      setSession(endAsMissed(pastFeedback(played.session, now), now, played.verdict.says))
      return
    }

    // Solved, or on track with more to play. Either way the machine is pushed past the explaining and the effects
    // take it from there: the opponent replies, or the puzzle is finished and scored.
    setSession(pastFeedback(played.session, now))
    if (played.verdict.kind !== 'solved') setNote(null)
  }

  const dontKnow = (): void => {
    if (!run || !running || !session || !onScreen) return
    const finished = advance(session, { kind: 'give-up' }, Date.now())
    if (finished.ok) setSession({ ...finished.session, outcome: 'given-up' })
  }

  const stop = (): void => {
    if (!run || !running) return
    setRun(stopRun(run, Date.now()))
  }

  /*
   * What Orbis itself may do here. Above the two answers below, because a hook has to be.
   *
   * `start` is the same `begin` the three mode buttons call, with the refusal turned into a thrown reason: a run
   * that cannot be filled says why rather than starting an empty one, and that sentence is the run's own.
   */
  useSurface(
    puzzleRunSurface({
      run: () =>
        run === null
          ? null
          : {
              mode: MODE_LABEL[run.mode],
              score: run.solved,
              lives: run.livesLeft,
              // Asked of the run rather than counted down here, so it is the time that is really left. Survival has
              // no clock at all, which is a different thing from no time left.
              secondsLeft: remainingMs(run, Date.now()) === null ? null : Math.max(0, Math.round((remainingMs(run, Date.now()) ?? 0) / 1000)),
              over: !isRunning(run)
            },
      start: (id) => {
        const mode = RUN_MODES.find((one) => one.id === id)
        if (!mode) throw new Error(`There is no run called “${id}”.`)
        if (ladder.kind === 'none') throw new Error(`${ladder.says} ${ladder.why}`)
        begin(mode)
        return { mode: mode.label }
      },
      pool: () => puzzles.length,
      // Whatever the run itself last said -- including the reason a run would not start, which is the sentence
      // somebody needs when nothing happened.
      note: () => note
    })
  )

  // ---------------------------------------------------------------- nothing to run through

  if (ladder.kind === 'none') {
    return (
      <div className="cw-pz-rush">
        <EmptyState action={onMakePuzzles ? <Button size="small" kind="primary" onClick={onMakePuzzles}>Make some from my games</Button> : undefined}>
          {ladder.says} {ladder.why}
        </EmptyState>
      </div>
    )
  }

  // ---------------------------------------------------------------- choosing a mode

  if (run === null) {
    return (
      <div className="cw-pz-rush">
        <h3>A run against the clock</h3>
        <p className="cw-pz-faint">
          Puzzles one after another. Three lives. A wrong move ends that puzzle and costs one of them. They come in
          the order set out below, which is not the same as rated. There is nobody to race — that is the one part of
          this Orbis does not do.
        </p>

        <div className="cw-pz-rush-modes" role="group" aria-label="Pick a run">
          {RUN_MODES.map((mode) => {
            const standing = standings.find((one) => one.mode === mode.id)
            return (
              <button key={mode.id} type="button" className="cw-pz-rush-mode" onClick={() => begin(mode)}>
                <strong>{mode.label}</strong>
                <span>{mode.what}</span>
                <small>{standing?.says ?? 'No runs yet.'}</small>
              </button>
            )
          })}
        </div>

        <div className="cw-pz-rush-climb">
          <h4>What order the puzzles come in</h4>
          <p>{ladder.says}</p>
          <p className="cw-pz-faint">{ladder.why}</p>
          {ladder.shortOf.length > 0 && (
            <ul className="cw-pz-rush-shortof">
              {ladder.shortOf.map((one) => <li key={one}>{one}</li>)}
            </ul>
          )}
          {ladder.unchecked > 0 && (
            <p className="cw-pz-faint">
              {ladder.unchecked} of these {ladder.unchecked === 1 ? 'has' : 'have'} not been fully checked by an
              engine yet, so a run can include one.
            </p>
          )}
          <p className="cw-pz-faint">
            A puzzle is never served twice in one run, so a run ends when you reach the end of the{' '}
            {ladder.order.length} you have — a score made of puzzles you have just seen the answer to would not be a
            score.
          </p>
          {ladder.kind === 'counted' && (
            <>
              <button type="button" className="cw-pz-link" onClick={() => setShowCounting((on) => !on)} aria-expanded={showCounting}>
                {showCounting ? 'Hide what is counted' : 'What is counted?'}
              </button>
              {showCounting && (
                <ul className="cw-pz-rush-weights">
                  <li>Each legal move there is to look through: {COUNTED_WEIGHTS.perLegalMove} point.</li>
                  <li>Each move of a forced mate beyond the first: {COUNTED_WEIGHTS.perMoveBeyondTheFirst} points.</li>
                  <li>A move that gives no check and takes nothing: {COUNTED_WEIGHTS.quietMove} points.</li>
                  <li>Taken off for each working move beyond the first: {COUNTED_WEIGHTS.perExtraAnswer} points.</li>
                  <li className="cw-pz-faint">
                    Every one of those is counted from the position. What is Orbis’s own choice is the weights, and
                    the total is not a rating and is never shown as one.
                  </li>
                </ul>
              )}
            </>
          )}
        </div>

        {note && <p className="cw-pz-says" role="status">{note}</p>}
      </div>
    )
  }

  // ---------------------------------------------------------------- the run is over

  if (!running) {
    const finished = runRecordOf(run)
    const best = modeStanding(runs, run.mode).best
    return (
      <div className="cw-pz-rush">
        <h3>{MODE_LABEL[run.mode]} — over</h3>
        <p className="cw-pz-rush-score">{run.solved}</p>
        <p>{finished ? recordWordsFor(finished) : END_WORDS[run.ended ?? 'stopped']}</p>
        <p className="cw-pz-faint">
          {run.missed} {run.missed === 1 ? 'puzzle' : 'puzzles'} went wrong.
          {best && finished && best.id !== finished.id ? ` Your best in this mode is ${best.score}.` : ''}
          {best && finished && best.id === finished.id ? ' That is your best in this mode.' : ''}
        </p>
        {run.results.length > 0 && (
          <ol className="cw-pz-rush-results">
            {run.results.map((one, at) => {
              const puzzle = byId.get(one.puzzleId)
              return (
                <li key={`${one.puzzleId}-${at}`} className={one.solved ? 'is-solved' : 'is-missed'}>
                  <strong>{one.solved ? 'Solved' : one.why === 'shown' ? 'Asked to see it' : 'Not the idea'}</strong>
                  {' '}<span>{puzzle?.exercise.prompt ?? one.puzzleId}</span>
                  {' '}<small>{one.seconds}s</small>
                </li>
              )
            })}
          </ol>
        )}
        <p className="cw-pz-faint">
          Every puzzle in this run has gone into your history as an attempt, the same as if you had solved it on its
          own.
          {run.climb === 'rated'
            ? ' These puzzles have ratings, so your own figure has moved with each of them.'
            : ' Your rating has not moved: none of these puzzles has a rating, so there was nothing to measure against.'}
        </p>
        <div className="cw-pz-row">
          <Button size="small" kind="primary" onClick={() => setRun(null)}>Another run</Button>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------- running

  const left = remainingMs(run, Date.now())
  const lives = Array.from({ length: run.livesLeft }, (_, at) => at)
  const lost = Array.from({ length: Math.max(0, RUN_LIVES - run.livesLeft) }, (_, at) => at)

  const strip = (
      <div className="cw-pz-rush-strip">
        <p className="cw-pz-rush-clock" aria-label={left === null ? 'No clock' : 'Time left'}>
          {left === null ? 'No clock' : `${Math.ceil(left / 1000)}s`}
        </p>
        <p className="cw-pz-rush-solved" aria-label="Puzzles solved">{run.solved}</p>
        <p className="cw-pz-rush-lives" aria-label={`${run.livesLeft} of ${RUN_LIVES} lives left`}>
          {lives.map((at) => <span key={`on-${at}`} className="is-left" aria-hidden="true">●</span>)}
          {lost.map((at) => <span key={`off-${at}`} className="is-gone" aria-hidden="true">○</span>)}
        </p>
        <p className="cw-pz-faint">
          {run.streak > 1 ? `${run.streak} in a row. ` : ''}
          {run.order.length - run.at} still to come.
        </p>
        <Button size="tiny" kind="quiet" onClick={stop}>Stop</Button>
      </div>
  )

  if (!onScreen || !session) {
    return (
      <div className="cw-pz-rush">
        {strip}
        <p className="cw-pz-says" role="status">{note ?? 'Getting the next puzzle up.'}</p>
      </div>
    )
  }

  /*
   * The run uses the same shared layout as every other board in Chess World, so the board in a run is the same
   * size as the board anywhere else: as large as the room allows. The run's own clock, score and lives ride above
   * it as the strip, where a clock belongs.
   */
  return (
    <ChessStage
      className="cw-pz-stage cw-pz-rush-stage"
      label={`Puzzle in a run: ${onScreen.exercise.prompt}`}
      board={{
        fen: session.fen,
        orientation: solverOf(onScreen),
        interactive: session.state === 'active',
        onMove: (one) => move(one.uci),
        label: `Puzzle in a run: ${onScreen.exercise.prompt}`
      }}
      above={strip}
      right={
        <div className="cw-pz-side">
          <p className="cw-pz-ask">{onScreen.exercise.prompt}</p>
          <p className="cw-pz-note is-ok" role="status" aria-live="polite">
            {note ?? (session.state === 'awaiting-opponent' ? 'Now the other side replies.' : 'Play the move. One wrong move ends this puzzle.')}
          </p>
          <div className="cw-pz-row">
            <Button size="small" kind="quiet" disabled={session.state !== 'active'} onClick={dontKnow}>
              I don’t know — next one
            </Button>
          </div>
          <p className="cw-pz-faint">
            No hints in a run. Saying you do not know costs a life, the same as a wrong move.
          </p>
        </div>
      }
    />
  )
}

export default Rush
