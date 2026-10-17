import { Button, Chip, Field } from '../../../ui'
import { sayVerification, type Exercise } from '../../../../../shared/chess/exercise'
import { answerWorth } from '../../../../../shared/chess/academyPath'
import type { TaskAttempt } from './useTaskAttempt'

/**
 * The column beside the board while a task is being done: what is asked, the controls, the hints and the verdict.
 *
 * It draws what `useTaskAttempt` holds and nothing else. No board, because the board belongs to the layout -- which
 * is the whole reason this is a column and not a card.
 *
 * ## The two kinds of wrong stay two kinds of wrong
 *
 * A move that cannot be played and a move that is legal but misses the point arrive as different verdicts, and they
 * are drawn and worded differently. "Nothing has moved" is a rules answer; "that is not the idea" is a chess
 * answer. Mixing them is the fault the training layer was written to avoid.
 *
 * ## A hint costs something and says so before it is taken
 *
 * The button says what the next hint will leave the go worth, and when the next hint shows the answer it says that
 * taking it makes this practice rather than a solve. Nothing is taken away quietly.
 */

export interface TaskPanelProps {
  attempt: TaskAttempt
  /**
   * Whether the lesson's assessment accepts a solve that took a hint showing the answer. False everywhere in the
   * Orbis curriculum; shown so nobody has to guess what a solve here will be worth.
   */
  countHinted: boolean
  /** What happened to it last time, when there is something worth saying. */
  note?: string | null
  /** How many goes have been had before this screen opened, so the button can say "another go" honestly. */
  priorAttempts: number
}

/** What the task asks for, in words, from what it actually says rather than from its objective's name. */
function askedFor(task: Exercise): string {
  if (task.objective === 'mate-in-n') {
    const moves = task.movesToMate ?? 1
    return `Force checkmate in ${moves} ${moves === 1 ? 'move' : 'moves'}.`
  }
  if (task.objective === 'win-material') {
    const centipawns = task.materialAtLeast ?? 0
    return `Come out at least ${centipawns} centipawns ahead — ${describeMaterial(centipawns)}.`
  }
  if (task.objective === 'hold-draw') return 'Reach a drawn position.'
  if (task.objective === 'reconstruct') return 'Play the line out on the board.'
  if (task.objective === 'answer') return 'Give the answer below.'
  return 'Find the best move.'
}

/** Centipawns said as pieces, because "300 centipawns" is not what anybody is thinking. */
function describeMaterial(centipawns: number): string {
  if (centipawns >= 900) return 'a queen or more'
  if (centipawns >= 500) return 'a rook or more'
  if (centipawns >= 300) return 'a knight or bishop at least'
  if (centipawns >= 100) return 'a pawn at least'
  return 'some material'
}

export function TaskPanel({ attempt, countHinted, note = null, priorAttempts }: TaskPanelProps): React.JSX.Element {
  const {
    task, broken, checked, answered, running, over, solvedNow, forgiven, session, answer, feedback, shownHints,
    replyNote, gap, chosen, typed, verdict, worth, hintCost, line, goes
  } = attempt

  if (broken) {
    return (
      <section className="cw-ac-taskpanel is-broken" aria-label={`Task: ${task.prompt}`}>
        <h4 className="cw-ac-prompt">{task.prompt}</h4>
        <p className="cw-ac-faulty" role="status">
          This task did not pass its own check, so Orbis will not put it in front of you as if it had.
        </p>
        <ul className="cw-ac-faults">
          {(task.verification.problems ?? ['No reason was recorded.']).map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      </section>
    )
  }

  return (
    <section className={`cw-ac-taskpanel${solvedNow ? ' is-solved' : ''}`} aria-label={`Task: ${task.prompt}`}>
      <header className="cw-ac-taskhead">
        <h4 className="cw-ac-prompt">{task.prompt}</h4>
        <p className="cw-ac-asked">{askedFor(task)}</p>
        {/* Short on screen, with the whole sentence on hover: a line about how the task was checked is worth
            having and is not worth four lines above the controls. */}
        <p className="cw-ac-checked" title={checked ? sayVerification(task.verification) : `Not checked: ${task.verification.needs ?? 'unknown'}.`}>
          {checked ? 'Checked against the rules' : 'Not checked'}
        </p>
      </header>

      {!running && !over && (
        <>
          <p className="cw-ac-faint">
            {task.sideToMove === 'w' ? 'White' : 'Black'} to move.
            {forgiven > 0 ? ` ${forgiven} wrong ${forgiven === 1 ? 'try' : 'tries'} are forgiven.` : ' It asks for the right answer first time.'}
          </p>
          {note && <p className="cw-ac-note" role="status">{note}</p>}
          <Button size="small" kind="primary" onClick={attempt.begin}>{goes + priorAttempts > 0 ? 'Another go' : 'Start'}</Button>
        </>
      )}

      {running && !answered && session && (
        <>
          <p className="cw-ac-turn" role="status">
            {session.state === 'awaiting-opponent'
              ? 'They are about to reply.'
              : session.state === 'awaiting-feedback'
                ? 'Read that, then carry on.'
                : `Your move. ${session.wrongMoves} wrong so far${forgiven > 0 ? ` of ${forgiven} forgiven` : ''}.`}
          </p>
          {session.played.length > 0 && (
            <ol className="cw-ac-played" aria-label="Moves played in this go">
              {session.played.map((move, index) => (
                <li key={`${move.uci}-${index}`} className={move.by === 'opponent' ? 'is-them' : ''}>{move.san}</li>
              ))}
            </ol>
          )}
        </>
      )}

      {running && answered && answer && (
        <div className="cw-ac-answer">
          {task.answer?.kind === 'destinations' && (
            <>
              <p className="cw-ac-faint">
                Name the squares. The board marks the ones you have named; it is not showing you the answer.
              </p>
              <div className="cw-ac-addsquare">
                <Field label="A square" hint="Two characters, like e4.">
                  {(wiring) => (
                    <input
                      {...wiring}
                      className="cw-ac-input"
                      value={typed}
                      onChange={(event) => attempt.setTyped(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); attempt.addSquare() } }}
                      maxLength={2}
                      autoComplete="off"
                    />
                  )}
                </Field>
                <Button size="tiny" onClick={attempt.addSquare} disabled={typed.trim() === ''}>Add</Button>
              </div>
              {chosen.length > 0 && (
                <ul className="cw-ac-chosen" aria-label="Squares you have named">
                  {chosen.map((square) => (
                    <li key={square}>
                      <Chip on onClick={() => attempt.removeSquare(square)} aria-label={`Remove ${square}`}>
                        {square} ✕
                      </Chip>
                    </li>
                  ))}
                </ul>
              )}
              <div className="cw-ac-row">
                <Button size="small" kind="primary" onClick={() => attempt.submitAnswer({ squares: chosen })} disabled={chosen.length === 0}>
                  That is all of them
                </Button>
                <Button size="small" onClick={() => attempt.submitAnswer({ squares: [] })} disabled={chosen.length > 0}>
                  There are none
                </Button>
              </div>
            </>
          )}

          {task.answer?.kind === 'count' && (
            <div className="cw-ac-addsquare">
              <Field label="How many">
                {(wiring) => (
                  <input
                    {...wiring}
                    className="cw-ac-input"
                    type="number"
                    min={0}
                    value={typed}
                    onChange={(event) => attempt.setTyped(event.target.value)}
                  />
                )}
              </Field>
              <Button size="small" kind="primary" onClick={() => attempt.submitAnswer({ value: Number(typed) })} disabled={typed.trim() === ''}>
                Answer
              </Button>
            </div>
          )}

          {task.answer?.kind === 'text' && (
            <div className="cw-ac-addsquare">
              <Field label="Your answer" hint="Orbis can only match this against the wordings the lesson lists.">
                {(wiring) => (
                  <input {...wiring} className="cw-ac-input" value={typed} onChange={(event) => attempt.setTyped(event.target.value)} />
                )}
              </Field>
              <Button size="small" kind="primary" onClick={() => attempt.submitAnswer({ text: typed })} disabled={typed.trim() === ''}>
                Answer
              </Button>
            </div>
          )}

          <p className="cw-ac-turn" role="status">
            {answer.wrong} wrong so far{forgiven > 0 ? ` of ${forgiven} forgiven` : ''}.
          </p>
        </div>
      )}

      {(running || over) && (
        <div className="cw-ac-row">
          {session?.state === 'awaiting-feedback' && (
            <Button size="small" kind="primary" onClick={attempt.clearFeedback}>
              {session.pending === 'solved' ? 'Finish' : 'Carry on'}
            </Button>
          )}
          {running && hintCost.hint && (
            <Button
              size="tiny"
              onClick={attempt.askForHint}
              title={hintCost.warns
                ? 'This one shows the answer. A solve after it is recorded as practice, not a solve.'
                : `A solve after this counts for ${Math.round(hintCost.worthAfter * 100)} per cent of a clean one.`}
            >
              {hintCost.warns ? 'Show me the answer' : `Hint (leaves it worth ${Math.round(hintCost.worthAfter * 100)}%)`}
            </Button>
          )}
          {running && <Button size="tiny" kind="quiet" onClick={attempt.giveUp}>Give up</Button>}
          {over && <Button size="small" onClick={attempt.again}>Another go</Button>}
        </div>
      )}

      {shownHints.length > 0 && (
        <ol className="cw-ac-hints" aria-label="Hints you have taken">
          {shownHints.map((hint) => (
            <li key={hint.level}><strong>Hint {hint.level}</strong> {hint.text}</li>
          ))}
        </ol>
      )}

      {worth && worth.worth < 1 && running && <p className="cw-ac-worth" role="status">{worth.says}</p>}

      {replyNote && <p className="cw-ac-reply" role="status">{replyNote}</p>}
      {gap && <p className="cw-ac-faulty" role="status">{gap}</p>}

      {feedback && (
        <div className={`cw-ac-verdict is-${feedback.tone}`} role="status">
          <p>{feedback.text}</p>
          {feedback.why && <p className="cw-ac-why">{feedback.why}</p>}
        </div>
      )}

      {verdict && (
        <div className={`cw-ac-verdict is-${verdict.ok ? 'good' : 'wrong'}`} role="status">
          <p>{verdict.says}</p>
          {!verdict.checkable && <p className="cw-ac-why">Orbis cannot settle this one from the rules alone.</p>}
        </div>
      )}

      {over && (
        <div className="cw-ac-over">
          {solvedNow
            ? <p className="cw-ac-good">{answered && answer ? answerWorth(answer, task).says : 'Solved.'}</p>
            : <p className="cw-ac-plain">Not this time. The record says what happened, and nothing more.</p>}
          {!countHinted && answered && answer?.outcome === 'solved' && answerWorth(answer, task).worth <= 0 && (
            <p className="cw-ac-faint">This lesson does not count a solve with the answer on screen. Another go would.</p>
          )}
          {task.lesson && <p className="cw-ac-lessonline">{task.lesson}</p>}
          {!solvedNow && line.length > 0 && <p className="cw-ac-line">The answer: {line.join(' ')}</p>}
          {!solvedNow && answered && Array.isArray(verdict?.truth) && (
            <p className="cw-ac-line">The answer: {verdict.truth.length === 0 ? 'there are none' : verdict.truth.join(', ')}</p>
          )}
          {!solvedNow && answered && typeof verdict?.truth === 'number' && (
            <p className="cw-ac-line">The answer: {verdict.truth}</p>
          )}
        </div>
      )}
    </section>
  )
}

export default TaskPanel
