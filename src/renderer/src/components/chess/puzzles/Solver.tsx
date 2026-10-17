import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../../ui'
import { ChessStage } from '../ChessStage'
import {
  advance, elapsedMs, newAttempt, opponentReply, performanceOf, playMove, takeHint, worthOf,
  type AttemptSession, type Performance, type Verdict
} from '../../../../../shared/chess/attempt'
import { sayVerification, type ExerciseHint } from '../../../../../shared/chess/exercise'
import { validateExercise } from '../../../../../shared/chess/exercise'
import { THEME_LABEL, isFact, provenanceWords, solverOf, type Puzzle } from '../../../../../shared/chess/puzzles'
import { describeDifficulty } from '../../../../../shared/chess/puzzleRating'

/**
 * Solving one puzzle.
 *
 * ## The two kinds of wrong are never mixed up
 *
 * A move that cannot be played is a rules problem. A move that can be played and is not the answer is a chess
 * problem. `judge` in `attempt.ts` answers those two questions separately and this screen keeps them separate on
 * purpose: a move Orbis will not accept says **"that cannot be played here, nothing has moved"**, and a move that
 * is simply not the idea says so and says nothing about whether it was any good.
 *
 * The board only ever offers legal moves, so the first kind cannot happen by clicking. It can happen by typing,
 * which is why there is a box to type a move into -- it is the way somebody who prefers notation solves a puzzle,
 * and it is also the only place the difference between illegal and wrong is visible.
 *
 * ## A right answer the author did not write down is still right
 *
 * `judge` proves a mate from the position rather than from the recorded line, so finding a different mate is a
 * solve and is told so. Nothing here second-guesses that.
 *
 * ## Hints cost something, and the cost is said before it is paid
 *
 * The ladder is `exercise.ts`'s: what it is about, what kind of move, which piece, which square, the move. Taking
 * the last rung means the attempt is practice rather than a solve, and the button says so before it is pressed.
 */

export interface SolverProps {
  puzzle: Puzzle
  /** The local day, when this attempt is that day's challenge. It is what makes a streak a record of real days. */
  day?: string
  /** Called once, when the attempt has finished. */
  onFinished: (performance: Performance, day?: string) => void
  /** Offered after it is over, when there is somewhere to go next. */
  onNext?: () => void
  /** What the collection already knows about this one. */
  history?: string
}

type Note = { tone: 'illegal' | 'wrong' | 'ok' | 'solved' | 'over' | 'gap'; text: string }

function noteFor(verdict: Verdict): Note {
  switch (verdict.kind) {
    case 'illegal':
      return { tone: 'illegal', text: verdict.says }
    case 'not-the-idea':
      return { tone: 'wrong', text: verdict.says }
    case 'on-track':
      return { tone: 'ok', text: verdict.why ? `${verdict.says} ${verdict.why}` : verdict.says }
    case 'solved':
      return { tone: 'solved', text: verdict.why ? `${verdict.says} ${verdict.why}` : verdict.says }
    case 'opponent-off-book':
      return { tone: 'gap', text: verdict.says }
    default:
      return { tone: 'over', text: verdict.says }
  }
}

export function Solver({ puzzle, day, onFinished, onNext, history }: SolverProps): React.JSX.Element {
  const exercise = puzzle.exercise
  const [session, setSession] = useState<AttemptSession>(() => newAttempt({ id: `${puzzle.id}-1`, exercise, now: Date.now() }))
  const [note, setNote] = useState<Note | null>(null)
  const [taken, setTaken] = useState<ExerciseHint[]>([])
  const [typed, setTyped] = useState('')
  const [typeProblem, setTypeProblem] = useState<string | null>(null)
  const reported = useRef<string | null>(null)

  // A different puzzle is a different attempt, from the beginning.
  useEffect(() => {
    setSession(newAttempt({ id: `${puzzle.id}-1`, exercise, now: Date.now() }))
    setNote(null)
    setTaken([])
    setTyped('')
    setTypeProblem(null)
  }, [puzzle.id, exercise])

  // Getting the position on the board is its own state, so a move cannot arrive before the board is ready.
  useEffect(() => {
    if (session.state !== 'ready') return
    const loading = advance(session, { kind: 'load' }, Date.now())
    if (!loading.ok) return
    const active = advance(loading.session, { kind: 'loaded' }, Date.now())
    setSession(active.ok ? active.session : loading.session)
  }, [session])

  // The opponent's reply comes from the puzzle's own lines, after a beat so it can be seen to happen.
  useEffect(() => {
    if (session.state !== 'awaiting-opponent') return
    const timer = setTimeout(() => {
      const reply = opponentReply(exercise, session.played.map((one) => one.uci))
      if (!reply) {
        // Nothing recorded for this position. That is a gap in the puzzle, and it is said rather than hidden.
        setNote({ tone: 'gap', text: 'The puzzle has no reply recorded here, so it cannot go on. That is a gap in the puzzle, not a mistake by you.' })
        const stopped = advance(session, { kind: 'give-up' }, Date.now())
        if (stopped.ok) setSession({ ...stopped.session, outcome: 'failed', why: 'The puzzle had no reply recorded.' })
        return
      }
      const moved = advance(session, { kind: 'opponent-moved', move: reply }, Date.now())
      if (moved.ok) setSession(moved.session)
    }, 420)
    return () => clearTimeout(timer)
  }, [session, exercise])

  // Something has been explained; play goes on, or the attempt is over.
  useEffect(() => {
    if (session.state !== 'awaiting-feedback') return
    const timer = setTimeout(() => {
      const next = advance(session, { kind: 'feedback-done' }, Date.now())
      if (next.ok) setSession(next.session)
    }, session.pending === 'solved' ? 320 : 1100)
    return () => clearTimeout(timer)
  }, [session])

  // The record goes out once, when it is really over.
  useEffect(() => {
    if (session.state !== 'completed' && session.state !== 'failed' && session.state !== 'abandoned') return
    if (reported.current === session.id) return
    reported.current = session.id
    onFinished(performanceOf(session, exercise, Date.now()), day)
  }, [session, exercise, day, onFinished])

  const submit = (text: string): void => {
    if (session.state !== 'active') return
    const played = playMove(session, exercise, text, Date.now())
    if (!played.ok) {
      setNote({ tone: 'over', text: played.says ?? 'That move cannot be taken just now.' })
      return
    }
    setSession(played.session)
    setNote(noteFor(played.verdict))
  }

  const onTyped = (): void => {
    const text = typed.trim()
    if (!text) {
      setTypeProblem('Type a move, like Nf3 or g1f3.')
      return
    }
    setTypeProblem(null)
    setTyped('')
    submit(text)
  }

  const hint = (): void => {
    const got = takeHint(session, exercise)
    setSession(got.session)
    if (got.hint) {
      setTaken((held) => [...held, got.hint as ExerciseHint])
      setNote({ tone: 'ok', text: `${got.hint.text} ${got.says}` })
    } else {
      setNote({ tone: 'ok', text: got.says })
    }
  }

  const giveUp = (): void => {
    const stopped = advance(session, { kind: 'give-up' }, Date.now())
    if (stopped.ok) setSession({ ...stopped.session, outcome: 'given-up' })
  }

  const over = session.state === 'completed' || session.state === 'failed' || session.state === 'abandoned'
  const solved = session.outcome === 'solved'
  const worth = worthOf(session, exercise)
  const last = session.played[session.played.length - 1]
  const nextHint = exercise.hints.find((one) => !session.hintsTaken.includes(one.level))

  // The answer, written out, and the facts about how hard it was. Only worked out once it is over.
  const answer = useMemo(() => {
    if (!over) return null
    const check = validateExercise(exercise)
    const line = check.lines[0]
    return {
      lines: check.lines.slice(0, 4).map((one) => one.san.join(' ')),
      more: Math.max(0, check.lines.length - 4),
      first: line ? line.san[0] : null
    }
  }, [over, exercise])

  const difficulty = useMemo(() => (over ? describeDifficulty(exercise) : null), [over, exercise])

  const facts = puzzle.themes.filter(isFact)
  const said = puzzle.themes.filter((one) => !isFact(one))

  /*
   * The side column: everything about the puzzle except the puzzle itself.
   *
   * It is handed to `ChessStage` rather than placed beside a board here, because the stage is what measures the
   * room and decides how big the board is. The board was 357px wide when each screen arranged its own.
   */
  const side = (
      <div className="cw-pz-side">
        <p className="cw-pz-where">{provenanceWords(puzzle)}</p>
        {history ? <p className="cw-pz-faint">{history}</p> : null}

        <p className={`cw-pz-note is-${note?.tone ?? 'none'}`} role="status" aria-live="polite">
          {note
            ? note.text
            : session.state === 'active'
              ? 'Play the move you think wins. The board will only let you play legal moves; you can also type one.'
              : session.state === 'awaiting-opponent'
                ? 'Now the other side replies.'
                : 'Setting the position up.'}
        </p>

        {!over && (
          <>
            <div className="cw-pz-typed">
              <label htmlFor={`cw-pz-move-${puzzle.id}`}>Or type a move</label>
              <div className="cw-pz-typed-row">
                <input
                  id={`cw-pz-move-${puzzle.id}`}
                  className="cw-pz-input"
                  value={typed}
                  placeholder="Nf3"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={session.state !== 'active'}
                  aria-describedby={typeProblem ? `cw-pz-move-why-${puzzle.id}` : undefined}
                  onChange={(event) => setTyped(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onTyped() } }}
                />
                <Button size="tiny" disabled={session.state !== 'active'} onClick={onTyped}>Play it</Button>
              </div>
              {typeProblem ? <p className="cw-pz-why" id={`cw-pz-move-why-${puzzle.id}`}>{typeProblem}</p> : null}
            </div>

            <div className="cw-pz-counts">
              <span>{session.wrongMoves} wrong {session.wrongMoves === 1 ? 'move' : 'moves'}</span>
              {session.illegalTries > 0 && <span>{session.illegalTries} {session.illegalTries === 1 ? 'move' : 'moves'} that could not be played</span>}
              <span>{Math.round(elapsedMs(session, Date.now()) / 1000)}s</span>
            </div>

            {taken.length > 0 && (
              <ol className="cw-pz-hints" aria-label="Hints taken">
                {taken.map((one) => <li key={one.level}>{one.text}</li>)}
              </ol>
            )}

            <div className="cw-pz-row">
              <Button size="small" disabled={!nextHint || session.state !== 'active'} onClick={hint}>
                {nextHint
                  ? nextHint.shows === 'move' ? 'Show me the move (this stops counting as a solve)' : 'Give me a hint'
                  : 'No more hints'}
              </Button>
              <Button size="small" kind="quiet" disabled={over} onClick={giveUp}>Show the answer</Button>
            </div>
            {worth.worth < 1 && <p className="cw-pz-faint">{worth.says}</p>}
          </>
        )}

        {over && (
          <div className="cw-pz-after">
            <h4 className={solved ? 'cw-pz-done' : 'cw-pz-missed'}>
              {solved ? (worth.counts ? 'Solved.' : 'Solved, with the move shown.') : session.outcome === 'given-up' ? 'You asked to see it.' : 'Not this time.'}
            </h4>
            {session.why ? <p className="cw-pz-faint">{session.why}</p> : null}
            {!worth.counts && solved ? <p className="cw-pz-faint">{worth.says}</p> : null}

            {answer?.lines.length ? (
              <div className="cw-pz-answer">
                <h5>The answer</h5>
                <ul className="cw-pz-linelist">
                  {answer.lines.map((line) => <li key={line}><code>{line}</code></li>)}
                </ul>
                {answer.more > 0 && <p className="cw-pz-faint">And {answer.more} more {answer.more === 1 ? 'line' : 'lines'} that also work.</p>}
              </div>
            ) : null}

            {exercise.lesson ? <p className="cw-pz-lesson">{exercise.lesson}</p> : null}

            <p className="cw-pz-check">{sayVerification(exercise.verification)}</p>
            {exercise.verification.problems?.length ? (
              <ul className="cw-pz-problems">
                {exercise.verification.problems.slice(0, 3).map((one) => <li key={one}>{one}</li>)}
              </ul>
            ) : null}

            {facts.length > 0 && (
              <div className="cw-pz-themes">
                <h5>What this was about</h5>
                <ul>
                  {facts.map((claim) => <li key={claim.theme}><strong>{THEME_LABEL[claim.theme]}</strong> — {claim.says}</li>)}
                </ul>
              </div>
            )}
            {said.length > 0 && (
              <div className="cw-pz-themes is-said">
                <h5>Said about it, not checked</h5>
                <ul>
                  {said.map((claim) => <li key={claim.theme}><strong>{THEME_LABEL[claim.theme]}</strong> — {claim.says}</li>)}
                </ul>
              </div>
            )}

            {difficulty && (
              <div className="cw-pz-difficulty">
                <h5>How hard it was</h5>
                <p className="cw-pz-faint">
                  {puzzle.rating === null
                    ? 'Nobody has rated this one, so there is no number. What there is, counted off the board:'
                    : `Rated ${puzzle.rating}${puzzle.ratingFrom === 'source' ? ', by whoever it came from' : ', measured against your own attempts alone'}. And, counted off the board:`}
                </p>
                <ul>{difficulty.facts.map((one) => <li key={one}>{one}</li>)}</ul>
              </div>
            )}

            {onNext ? <div className="cw-pz-row"><Button size="small" kind="primary" onClick={onNext}>Next puzzle</Button></div> : null}
          </div>
        )}
      </div>
  )

  return (
    <ChessStage
      className="cw-pz-stage"
      label={`Puzzle: ${exercise.prompt}`}
      board={{
        fen: session.fen,
        orientation: solverOf(puzzle),
        interactive: session.state === 'active',
        lastMove: last ? { from: last.uci.slice(0, 2), to: last.uci.slice(2, 4) } : null,
        onMove: (move) => submit(move.uci),
        label: `Puzzle: ${exercise.prompt}`
      }}
      above={
        <div className="cw-pz-asking">
          <p className="cw-pz-ask">{exercise.prompt}</p>
          <p className="cw-pz-turn">You have {solverOf(puzzle) === 'w' ? 'White' : 'Black'}</p>
        </div>
      }
      right={side}
    />
  )
}

export default Solver
