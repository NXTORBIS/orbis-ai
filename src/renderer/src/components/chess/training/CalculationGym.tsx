import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Chip, EmptyState, Segmented } from '../../../ui'
import { TrainStage } from './TrainStage'
import { LineBox } from './LineBox'
import { useSurface } from '../../../lib/surfaces'
import { calculationSurface } from '../chessSurfaces'
import { useTrainingStore } from './store'
import {
  appendSolverMove, attemptId, calculationReport, dropLast, gymPool, gymView, hintWorth, lineText, newDraft,
  nextFen, rootsAreComplete, sayCount, shownLine, solutionLines, standingOf, submitLine, groupCandidates,
  promptWhileHidden,
  type Exercise, type GymContext, type GymMode, type GymPool, type GymReport, type GymSubmission, type LineDraft,
  type Phase, type ReplySource
} from '../../../../../shared/chess/trainingView'
import { enterLine, type ReadResult } from '../../../../../shared/chess/calculation'
import type { NoticeKind } from '../../../lib/notices'
import type { ChessMove } from '../../../../../shared/chess/rules'
import './training.css'

/**
 * The Calculation Gym (Sections 211-220).
 *
 * Work a line out, write the whole thing down, and be told what the attempt established. Everything that decides
 * anything is in `src/shared/chess/trainingView.ts`, `calculation.ts` and `exercise.ts`; this file arranges it and
 * takes the clicks. Four things about it are deliberate.
 *
 * ## The board is never this screen's decision
 *
 * `gymView` is asked on every render and the board is drawn only when it hands back a position. There is no other
 * way for a position to reach the markup, which is what makes a hidden board hidden rather than hidden in the
 * places somebody remembered. A board drawn and then hidden with CSS is still in the document, in the accessibility
 * tree, in a tooltip and in a screenshot of the window.
 *
 * ## The whole line, not a move at a time
 *
 * A gym where you try moves on the board until it says yes is not a calculation gym -- it is a puzzle trainer with
 * extra steps. So the line is written out in notation, nothing is checked until it is submitted, and in a
 * hidden-board round there is nothing to try moves on anyway.
 *
 * ## What came back is sentences, not a mark
 *
 * `calculationReport` answers "what did this attempt establish". A hint taken, a defence supplied by Orbis and a
 * board left on screen each take something away from the claim, and each is named rather than folded into one
 * number that cannot be read back out later.
 *
 * ## It says how far the exercise itself has been checked
 *
 * The positions whose answers came out of an exhaustive search say so, and only those. Everywhere else a move that
 * is not one of the recorded answers is reported as not recorded, which is a fact about the exercise rather than
 * about the move.
 */

/** How many positions are offered at once before the list needs scrolling. All of them: there are fourteen. */
const REPLY_OPTIONS: readonly { value: ReplySource; label: string }[] = [
  { value: 'both-sides', label: 'You write both sides' },
  { value: 'from-the-exercise', label: 'Orbis answers for the other side' }
]

const MODE_OPTIONS: readonly { value: GymMode; label: string }[] = [
  { value: 'with-board', label: 'The board stays' },
  { value: 'hidden', label: 'The board goes' }
]

export interface CalculationGymProps {
  onNotify?: (text: string, kind?: NoticeKind) => void
}

export function CalculationGym({ onNotify }: CalculationGymProps = {}): React.JSX.Element {
  const kept = useTrainingStore()

  /**
   * The positions, built after the first paint rather than during it.
   *
   * `gymPool` re-checks every exercise against the rules when it is asked -- which is the point of it, and which
   * costs about six hundred milliseconds on this machine. Doing that inside the first render froze the window for
   * half a second with nothing on screen to say why. Handing it to a timeout lets the screen paint first; it is
   * still on the main thread, because the check is synchronous, so what this buys is that somebody can see it
   * happening rather than that the window stays live throughout. `gymPool` caches, so this is paid once a session.
   */
  const [pool, setPool] = useState<GymPool | null>(null)
  useEffect(() => {
    const id = window.setTimeout(() => setPool(gymPool()), 0)
    return () => window.clearTimeout(id)
  }, [])

  const [openId, setOpenId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('ready')
  const [mode, setMode] = useState<GymMode>('with-board')
  const [replies, setReplies] = useState<ReplySource>('both-sides')
  const [draft, setDraft] = useState<LineDraft | null>(null)
  const [candidates, setCandidates] = useState<readonly string[]>([])
  const [usingCandidates, setUsingCandidates] = useState(false)
  const [hints, setHints] = useState(0)
  const [movedOnBoard, setMovedOnBoard] = useState(false)
  const [report, setReport] = useState<GymReport | null>(null)
  const [submission, setSubmission] = useState<GymSubmission | null>(null)
  const [exploreFen, setExploreFen] = useState<string | null>(null)
  const [leftToStudy, setLeftToStudy] = useState(0)
  const [showAnswers, setShowAnswers] = useState(false)
  const startedAt = useRef(0)

  /*
   * The saved settings become the screen's, once, when the profile has answered.
   *
   * After that they are the person's to change on screen and the change is saved; reading them again would undo
   * whatever they just did. `settled` is also set the moment somebody moves either picker, because the read is not
   * instant and a change made while it was still in flight was being put straight back by this -- which is a
   * control that worked and looked dead.
   */
  const settled = useRef(false)
  useEffect(() => {
    if (kept.loading || settled.current) return
    settled.current = true
    setMode(kept.store.settings.strict ? 'hidden' : 'with-board')
    setReplies(kept.store.settings.replies)
  }, [kept.loading, kept.store.settings])

  /** The board picker, by hand or by Orbis. Whichever it is, the saved value stops being the screen's to take. */
  const chooseMode = useCallback((next: GymMode): void => {
    settled.current = true
    setMode(next)
    kept.settings({ strict: next === 'hidden' })
  }, [kept])

  /** Who writes the other side's moves. Same rule: once somebody has said, the read does not get to say again. */
  const chooseReplies = useCallback((next: ReplySource): void => {
    settled.current = true
    setReplies(next)
    kept.settings({ replies: next })
  }, [kept])

  const exercise = useMemo<Exercise | null>(
    () => pool?.exercises.find((one) => one.id === openId) ?? null,
    [pool, openId]
  )


  const open = useCallback((one: Exercise): void => {
    setOpenId(one.id)
    setPhase('ready')
    setDraft(newDraft(one.startFen))
    setCandidates([])
    setUsingCandidates(false)
    setHints(0)
    setMovedOnBoard(false)
    setReport(null)
    setSubmission(null)
    setExploreFen(null)
    setShowAnswers(false)
  }, [])

  /** Starting a round. In a hidden round there is a look at the position first; otherwise it begins straight away. */
  const begin = useCallback((): void => {
    if (!exercise) return
    startedAt.current = Date.now()
    setExploreFen(null)
    setMovedOnBoard(false)
    if (mode === 'hidden') {
      setLeftToStudy(Math.max(5, kept.store.settings.studySeconds))
      setPhase('studying')
      return
    }
    setPhase('answering')
  }, [exercise, mode, kept.store.settings.studySeconds])

  // The look at the position, counted down. One second at a time so the number on screen is the number left.
  useEffect(() => {
    if (phase !== 'studying') return undefined
    if (leftToStudy <= 0) {
      setPhase('answering')
      return undefined
    }
    const id = window.setTimeout(() => setLeftToStudy((left) => left - 1), 1000)
    return () => window.clearTimeout(id)
  }, [phase, leftToStudy])

  /*
   * What Orbis itself may do here.
   *
   * The two settings go both places the pickers themselves put them: on screen now, and in the record. The
   * exercises a round can be built from are whatever the pool holds, so one added to it becomes one Orbis can open
   * without anybody editing a list.
   */
  useSurface(
    calculationSurface({
      exercises: () => (pool?.exercises ?? []).map((one) => ({ id: one.id, prompt: one.prompt })),
      open: () => openId,
      openExercise: (id) => {
        const found = pool?.exercises.find((one) => one.id === id)
        if (!found) throw new Error(`There is no exercise called “${id}”.`)
        open(found)
      },
      mode: () => mode,
      setMode: chooseMode,
      replies: () => replies,
      setReplies: chooseReplies,
      phase: () => phase,
      begin,
      report: () => report?.heading ?? null
    })
  )

  /**
   * Whether the board may be on screen, asked afresh on every render.
   *
   * `doneFen` is where the report points: the position the parting move was played *in*, which is the one worth
   * looking at. The position after a wrong move is a position nobody needs to study.
   */
  const view = useMemo(() => {
    const fen = exercise?.startFen ?? ''
    if (!fen) return null
    return gymView({
      mode,
      phase,
      fen: exploreFen ?? fen,
      ...(report?.showFen ? { doneFen: report.showFen } : {})
    })
  }, [exercise, mode, phase, exploreFen, report])

  /** Moving the pieces about on the board, which is a way of working a line out and is recorded as one. */
  const explore = useCallback((move: ChessMove): void => {
    setExploreFen(move.after)
    setMovedOnBoard(true)
  }, [])

  /*
   * The moves worth considering, worked out only once somebody asks for them.
   *
   * `groupCandidates` is every legal move sorted into forcing groups, and on the heaviest position in the gym it
   * takes 217 milliseconds. It used to run the moment an exercise was opened, which put a fifth of a second between
   * clicking a position in the list and the screen answering -- long enough for the row to look like it did nothing.
   * The list is behind "Name your candidate moves first" and is not drawn while the board is away, so it is worked
   * out when both of those are true and not before.
   */
  const wantsCandidates = usingCandidates && exercise !== null && view?.boardFen !== null
  const groups = useMemo(
    () => (wantsCandidates && exercise ? groupCandidates(exercise.startFen) : []),
    [wantsCandidates, exercise]
  )

  /**
   * The line as it will be compared, and the position the next move belongs to.
   *
   * Both come from `trainingView`, because both depend on who is writing the other side's moves and neither is
   * this file's to work out. With Orbis supplying the replies, the line shown is the one with them in it -- the
   * line that is really checked -- and the next move is read against the position that reply reached.
   */
  const shown = useMemo(
    () => (exercise && draft ? shownLine(exercise, draft, replies) : null),
    [exercise, draft, replies]
  )
  const writeAgainst = useMemo(
    () => (exercise && draft ? nextFen(exercise, draft, replies) : ''),
    [exercise, draft, replies]
  )

  const addMoves = useCallback((texts: readonly string[]): ReadResult | null => {
    if (!exercise || !draft) return null
    let next = draft
    for (const text of texts) {
      const out = appendSolverMove(exercise, next, replies, text)
      // Everything up to the refusal is kept. Throwing away four good moves because the fifth was mistyped is the
      // kind of thing that makes somebody stop using a trainer.
      if (!out.added) {
        setDraft(next)
        return out.read
      }
      next = out.draft
    }
    setDraft(next)
    return null
  }, [exercise, draft, replies])

  const submit = useCallback((): void => {
    if (!exercise || !draft || !view) return
    const out = submitLine(exercise, draft, replies)
    const context: GymContext = {
      // Asked of the view rule rather than worked out again here. `scored` is its answer to "was this a
      // hidden-board go", and a second copy of that test in this file is a second thing to get wrong.
      strict: view.scored && !movedOnBoard,
      movedOnBoard,
      hintsTaken: hints,
      replies,
      candidates
    }
    const made = calculationReport(exercise, out, context)
    setSubmission(out)
    setReport(made)
    setPhase('done')

    const now = Date.now()
    kept.record({
      id: attemptId(now),
      at: now,
      area: 'calculation',
      item: exercise.id,
      strict: context.strict,
      verdict: made.heading,
      passed: out.comparison.verdict === 'solves',
      hints,
      line: out.compared,
      ...(startedAt.current > 0 ? { ms: Math.max(0, now - startedAt.current) } : {})
    })
    onNotify?.(made.heading, 'info')
  }, [exercise, draft, view, replies, movedOnBoard, hints, candidates, kept, onNotify])

  const takeHint = useCallback((): void => {
    if (!exercise) return
    if (hints >= exercise.hints.length) return
    setHints(hints + 1)
  }, [exercise, hints])

  const standing = useMemo(
    () => (exercise ? standingOf(kept.store, 'calculation', exercise.id) : null),
    [kept.store, exercise]
  )

  // The answering lines, read out only when they are asked for. On one exercise this is 92 milliseconds, and it was
  // being paid on every opening of a position whether anybody pressed "Show the answers" or not.
  const answers = useMemo(
    () => (showAnswers && exercise ? solutionLines(exercise) : []),
    [showAnswers, exercise]
  )

  const yourLine = useMemo(() => {
    if (!submission) return ''
    const walk = enterLine(submission.comparison.entry.startFen, submission.compared)
    return lineText(walk)
  }, [submission])

  return (
    <div className="cw-tr-gym">
      <aside className="cw-tr-side" aria-label="Positions to calculate">
        {pool === null
          ? <p className="cw-tr-says" role="status">Checking every position against the rules…</p>
          : <p className="cw-tr-says">{pool.says}</p>}
        {pool !== null && pool.refused.length > 0 && (
          <details className="cw-tr-refused">
            <summary>{pool.refused.length} not offered</summary>
            <ul>
              {pool.refused.map((one) => <li key={one.id}>{one.id}: {one.says}</li>)}
            </ul>
          </details>
        )}
        {pool === null
          ? null
          : pool.exercises.length === 0
          ? <EmptyState>Not one position passed its own check, so there is nothing to offer. The reasons are above.</EmptyState>
          : (
            <ul className="cw-tr-items">
              {pool.exercises.map((one) => {
                const was = standingOf(kept.store, 'calculation', one.id)
                return (
                  <li key={one.id}>
                    <button
                      type="button"
                      className={`cw-tr-item${one.id === openId ? ' cw-tr-item-on' : ''}`}
                      aria-current={one.id === openId ? 'true' : undefined}
                      onClick={() => open(one)}
                    >
                      <strong>
                        {one.objective === 'mate-in-n' && one.movesToMate
                          ? `Mate in ${sayCount(one.movesToMate)}`
                          : one.prompt.slice(0, 44)}
                      </strong>
                      <small>
                        {one.tags.filter((tag) => tag.startsWith('with-') || tag === 'bare-king').join(', ') || one.kind}
                        {was.passedStrict ? ' · solved with no board' : was.passedAnyhow ? ' · solved' : ''}
                      </small>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
      </aside>

      <section className="cw-tr-main" aria-label="Calculation Gym">
        {kept.readProblem !== null && (
          <p className="cw-tr-warn" role="status">{kept.readProblem} Nothing from this visit is being saved.</p>
        )}
        {kept.saveProblem !== null && <p className="cw-tr-warn" role="status">{kept.saveProblem}</p>}

        {!exercise || !draft || !view
          ? (
            <EmptyState>
              {/* "from the list", not "on the left": beside the chat sidebar this screen is about 600px wide and the
                  list moves to the top, so the old wording sent somebody looking at an empty edge of the screen. */}
              Pick a position from the list. You write the whole line out in notation before anything is checked --
              that is what makes it calculation rather than trying moves until one works.
            </EmptyState>
          )
          : (
            <>
              <header className="cw-tr-head">
                <h3 className="cw-tr-title">
                  {phase === 'answering' && mode === 'hidden' ? promptWhileHidden(exercise) : exercise.prompt}
                </h3>
                <p className="cw-tr-meta">
                  <span className={`cw-tr-badge${exercise.verification.status === 'verified' ? ' cw-tr-badge-ok' : ''}`}>
                    {exercise.verification.status === 'verified'
                      ? exercise.verification.coverage === 'complete'
                        ? 'Every defence answered'
                        : 'Checked against the rules'
                      : 'Not checked'}
                  </span>
                  {rootsAreComplete(exercise.id) && <span className="cw-tr-badge">First moves found by search</span>}
                  {standing && standing.attempts > 0 && (
                    <span className="cw-tr-faint">
                      {standing.attempts} {standing.attempts === 1 ? 'go' : 'goes'} kept
                      {standing.passedStrict ? ', solved with no board' : standing.passedAnyhow ? ', solved' : ''}
                    </span>
                  )}
                </p>
              </header>

              {phase === 'ready' && (
                <div className="cw-tr-setup">
                  <Segmented
                    label="What happens to the board"
                    className="cw-tr-seg"
                    optionClass="cw-tr-tab"
                    litClass="on"
                    value={mode}
                    options={MODE_OPTIONS}
                    onChange={chooseMode}
                  />
                  <Segmented
                    label="Who writes the other side's moves"
                    className="cw-tr-seg"
                    optionClass="cw-tr-tab"
                    litClass="on"
                    value={replies}
                    options={REPLY_OPTIONS}
                    onChange={chooseReplies}
                  />
                  {/*
                    * What the two pickers add up to, as three facts rather than the paragraph that used to sit
                    * here repeating what the pickers already say. The long version is the title on each badge.
                    */}
                  <ul className="cw-tr-terms" aria-label="How this go will be run">
                    <li
                      className="cw-tr-term"
                      title={mode === 'hidden'
                        ? 'The position goes off screen when the look is up, and you write the line from memory.'
                        : 'The position stays on screen and you can move the pieces about on it.'}
                    >
                      <span className="cw-tr-term-name">Board</span>
                      <span className="cw-tr-term-value">{mode === 'hidden' ? 'goes away' : 'stays'}</span>
                    </li>
                    <li
                      className="cw-tr-term"
                      title={mode === 'hidden'
                        ? 'How long you get to look at the position before it goes. Changed on the Blindfold screen.'
                        : 'Nothing is taken away, so there is no look to time.'}
                    >
                      <span className="cw-tr-term-name">Look</span>
                      <span className="cw-tr-term-value">
                        {mode === 'hidden'
                          ? `${sayCount(Math.max(5, kept.store.settings.studySeconds))}s`
                          : 'not timed'}
                      </span>
                    </li>
                    <li
                      className="cw-tr-term"
                      title={replies === 'from-the-exercise'
                        ? 'Orbis answers for the other side out of the exercise, which tells you which defence it expects.'
                        : 'You write both sides, which is what calculating a line is.'}
                    >
                      <span className="cw-tr-term-name">Their moves</span>
                      <span className="cw-tr-term-value">
                        {replies === 'from-the-exercise' ? 'Orbis writes them' : 'you write them'}
                      </span>
                    </li>
                    <li
                      className={`cw-tr-term${mode === 'hidden' ? ' is-counted' : ''}`}
                      title={mode === 'hidden'
                        ? 'A hidden-board go is the only kind that says anything about calculating in your head.'
                        : 'The report will say the position was on screen, because that is a different exercise.'}
                    >
                      <span className="cw-tr-term-name">Counts as</span>
                      <span className="cw-tr-term-value">
                        {mode === 'hidden' ? 'in your head' : 'with the board'}
                      </span>
                    </li>
                  </ul>
                  <div className="cw-tr-go">
                    <Button kind="primary" onClick={begin}>Start</Button>
                    <Button
                      kind="quiet"
                      on={usingCandidates}
                      onClick={() => setUsingCandidates(!usingCandidates)}
                    >
                      {usingCandidates ? 'Skip naming candidates' : 'Name your candidate moves first'}
                    </Button>
                  </div>
                </div>
              )}

              {phase === 'studying' && (
                <p className="cw-tr-count" role="status">
                  Look at it. {leftToStudy} {leftToStudy === 1 ? 'second' : 'seconds'} left.
                  {' '}
                  <Button size="small" kind="quiet" onClick={() => setLeftToStudy(0)}>I have it</Button>
                </p>
              )}

              {/*
                * The board, as big as the room allows, through the Train group's own arrangement.
                *
                * It used to be a 420-pixel column beside a panel, and that was the owner's complaint: the thing
                * the screen is about was the smallest thing on it. `TrainStage` hands a position to the shared
                * layout, which measures the room and gives the board a real pixel size. A round with no position
                * gets the empty square at exactly the same size, so nothing jumps when the position comes back.
                */}
              <TrainStage
                label="The position"
                className="cw-tr-stage"
                board={view.boardFen !== null
                  ? {
                    fen: view.boardFen,
                    orientation: exercise.sideToMove,
                    interactive: view.mayMovePieces,
                    ...(view.mayMovePieces ? { onMove: explore } : {}),
                    label: view.label
                  }
                  : null}
                away={{ label: view.label, because: view.because }}
                below={view.mayMovePieces && exploreFen !== null
                  ? (
                    <p className="cw-tr-explored">
                      You have moved the pieces about. That is recorded, and it is not the same as holding the line
                      in your head.
                      {' '}
                      <Button size="tiny" onClick={() => setExploreFen(null)}>Put them back</Button>
                    </p>
                  )
                  : undefined}
                right={<div className="cw-tr-aside">
                  {usingCandidates && phase !== 'done' && (
                    <div className="cw-tr-cands">
                      <p className="cw-tr-cands-label">
                        Which moves are worth calculating? Picked here, kept apart from the line you finally write.
                      </p>
                      {view.boardFen === null
                        ? (
                          <p className="cw-tr-faint">
                            The list of moves is not on screen while the board is away -- it would name every square
                            a piece can reach. Pick them while you can see the position.
                          </p>
                        )
                        : groups.map((group) => (
                          <div key={group.forcing} className="cw-tr-cand-group">
                            <h5 className="cw-tr-cand-head">{group.label}</h5>
                            <div className="cw-tr-cand-list">
                              {group.moves.map((one) => (
                                <Chip
                                  key={one.uci}
                                  className="cw-tr-cand"
                                  on={candidates.includes(one.uci)}
                                  title={one.says}
                                  onClick={() => setCandidates((now) =>
                                    now.includes(one.uci) ? now.filter((it) => it !== one.uci) : [...now, one.uci]
                                  )}
                                >
                                  {one.shown}
                                </Chip>
                              ))}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}

                  {phase === 'answering' && (
                    <>
                      {shown !== null && (
                        <LineBox
                          entry={shown}
                          nextFen={writeAgainst}
                          written={draft.texts.length}
                          onAdd={addMoves}
                          onUndo={() => setDraft(dropLast(draft))}
                          onRestart={() => setDraft(newDraft(exercise.startFen))}
                          micId={`cw-gym-${exercise.id}`}
                          label={replies === 'both-sides'
                            ? 'Write the line out, both sides, in order.'
                            : 'Write your own moves. Orbis answers for the other side out of the exercise.'}
                        />
                      )}
                      <div className="cw-tr-controls">
                        <Button kind="primary" disabled={draft.texts.length === 0} onClick={submit}>
                          Submit the line
                        </Button>
                        {view.hintsAllowed && exercise.hints.length > 0 && (
                          <Button size="small" disabled={hints >= exercise.hints.length} onClick={takeHint}>
                            {hints === 0 ? 'Take a hint' : 'Another hint'}
                          </Button>
                        )}
                      </div>
                      {!view.hintsAllowed && exercise.hints.length > 0 && (
                        <p className="cw-tr-faint">
                          There are hints, and they are not offered while the board is away: every one of them names a
                          square.
                        </p>
                      )}
                      {hints > 0 && (
                        <ol className="cw-tr-hints" aria-label="Hints taken">
                          {exercise.hints.slice(0, hints).map((hint) => (
                            <li key={hint.level}>{hint.text}</li>
                          ))}
                          <li className="cw-tr-faint">
                            A solve after {sayCount(hints)} {hints === 1 ? 'hint' : 'hints'} is worth{' '}
                            {Math.round(hintWorth(exercise, hints) * 100)} per cent of an unaided one.
                          </li>
                        </ol>
                      )}
                      <p className="cw-tr-faint">
                        The next move is read against {writeAgainst === exercise.startFen
                          ? 'the position you started from'
                          : replies === 'both-sides'
                            ? 'the position the line has reached'
                            : 'the position after the reply Orbis gave'}, never the one the exercise started in.
                      </p>
                    </>
                  )}

                  {phase === 'done' && report !== null && submission !== null && (
                    <div className="cw-tr-report">
                      <h4 className="cw-tr-report-head">{report.heading}</h4>
                      {yourLine !== '' && <p className="cw-tr-yours">What was compared: {yourLine}</p>}
                      {submission.stoppedSupplyingAt !== null && (
                        <p className="cw-tr-faint">
                          Orbis stopped answering for the other side at move {submission.stoppedSupplyingAt + 1}: your
                          move there left the recorded answers, so there was no defence to supply.
                        </p>
                      )}
                      <ul className="cw-tr-established">
                        {report.established.map((one, index) => (
                          <li key={`${index}-${one.settled}`} className={`cw-tr-set cw-tr-set-${one.settled}`}>
                            {one.says}
                          </li>
                        ))}
                      </ul>
                      {report.worth !== null && (
                        <p className="cw-tr-worth">
                          Worth {Math.round(report.worth * 100)} per cent of an unaided solve, by the exercise's own
                          hint ladder.
                        </p>
                      )}
                      {report.candidates.length > 0 && (
                        <ul className="cw-tr-cand-verdicts" aria-label="The candidates you named">
                          {report.candidates.map((one) => (
                            <li key={one.uci} className={`cw-tr-stand-${one.standing}`}>{one.says}</li>
                          ))}
                        </ul>
                      )}

                      <div className="cw-tr-controls">
                        <Button size="small" kind="primary" onClick={() => open(exercise)}>Go again</Button>
                        <Button size="small" onClick={() => setShowAnswers(!showAnswers)}>
                          {showAnswers ? 'Hide the answers' : 'Show the answers'}
                        </Button>
                      </div>
                      <p className="cw-tr-faint">
                        Going again keeps this attempt. The first go is the only one that says whether you could do it
                        unaided, so it is never written over.
                      </p>

                      {showAnswers && (
                        <div className="cw-tr-answers">
                          <p className="cw-tr-answers-label">
                            {answers.length === 1
                              ? 'The exercise\'s answer:'
                              : `All ${sayCount(answers.length)} answering lines, because an answer with four defences is four lines and showing one would suggest the others were not covered:`}
                          </p>
                          <ul>
                            {answers.map((one) => <li key={one.text}>{one.text}</li>)}
                          </ul>
                          <p className="cw-tr-faint">
                            {rootsAreComplete(exercise.id)
                              ? 'These came out of a search over every move, so a first move that is not here does not work.'
                              : 'These are the answers somebody wrote down, not every move that works. A move that is not here was not checked.'}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>}
              />
            </>
          )}
      </section>
    </div>
  )
}

export default CalculationGym
