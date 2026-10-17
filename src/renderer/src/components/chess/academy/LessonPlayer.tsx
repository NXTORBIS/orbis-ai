import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../../ui'
import { ChessStage } from '../ChessStage'
import { TaskPanel } from './TaskPanel'
import { useTaskAttempt } from './useTaskAttempt'
import { arrowMark, type Mark } from '../../../../../shared/chess/marks'
import type { Performance } from '../../../../../shared/chess/attempt'
import type { Exercise } from '../../../../../shared/chess/exercise'
import {
  READING_COUNTS_TOWARD_COMPLETION, assessedTasks, type LessonReading
} from '../../../../../shared/chess/lessons'
import type { LessonNode } from '../../../../../shared/chess/academyPath'
import {
  blockOfStep, boardForStep, clampStep, lessonSteps, stepForKey, stepOfBlock, stepOfTask, stepWords, walkLine,
  type LessonStep
} from '../../../../../shared/chess/lessonStage'
import { FirstIcon, LastIcon, NextIcon, PrevIcon } from '../icons'

/**
 * Taking a lesson: the board, large, with the lesson beside it.
 *
 * ## What changed and why
 *
 * This screen used to be a walk through a lesson's blocks, one block filling the screen at a time. A block is only
 * sometimes a position, so most steps of most lessons showed a heading, a paragraph, a list or a table and no board
 * at all -- a page of writing about chess -- and the few steps that did show one drew it in a shrink-to-fit box
 * about 357 pixels wide. The owner's words for it were that the board is not there in most cases and is extremely
 * small, and both were exactly true.
 *
 * Now the board is always on screen and it is the biggest thing on it. The lesson sits in the column beside it:
 * which step you are on down the left, what this step says down the right. What goes on the board is decided by
 * `lessonStage.ts`, which is tested, and the rule it follows is that the board shows the last position the lesson
 * actually gave -- so a paragraph about a diagram is read with that diagram still up, rather than replacing it.
 *
 * ## Next is never locked
 *
 * A task can be walked past. That is deliberate, and it is what makes the completion rule mean anything: if the
 * only way to reach the end were to solve everything, finishing would be the same as arriving, and `lessons.ts`
 * spent a whole module making sure those are different. Walking past a task leaves it undemonstrated, and the last
 * step says which ones those are.
 *
 * ## Reading is recorded and finishes nothing
 *
 * How far through, how long the lesson has been on screen, how many visits -- all kept, none of it touching the
 * completion. It is said in as many words, from `READING_COUNTS_TOWARD_COMPLETION` rather than from a sentence
 * somebody typed, so the screen cannot drift from the rule.
 */

export interface LessonPlayerProps {
  node: LessonNode
  reading: LessonReading
  /** Which block to open at, as the stored record counts blocks. */
  at: number
  /** Called as they move through, so where they are survives closing the Academy. */
  onPlace: (block: number) => void
  /** Called every few seconds with time the lesson has been open and in front. */
  onRead: (seconds: number) => void
  onFinished: (performance: Performance) => void
  onBack: () => void
  /** Where to go when this one is done. Null when there is nowhere. */
  next: { lessonId: string; title: string } | null
  onNext: (lessonId: string) => void
  /** How many goes have been had at each task already, by task id. */
  priorAttempts: Readonly<Record<string, number>>
  /** What the scheduler said about the last attempt at each task. */
  notes: Readonly<Record<string, string>>
}

/** How often time on screen is added up. Small enough to be accurate, large enough not to be a write per second. */
const TICK_SECONDS = 5

/** The lesson's own arrows, as marks the board draws itself, so they scale with the board instead of over it. */
function marksFor(arrows: readonly { from: string; to: string }[]): Mark[] {
  const made: Mark[] = []
  for (const arrow of arrows) {
    const mark = arrowMark(arrow.from, arrow.to, 'blue')
    if (mark) made.push(mark)
  }
  return made
}

/** A step that is one of the lesson's tasks: the board is the task's, the column beside it is the task's controls. */
function TaskStep({
  task, priorAttempts, countHinted, onFinished, note, left, below, label, onDone
}: {
  task: Exercise
  priorAttempts: number
  countHinted: boolean
  onFinished: (performance: Performance) => void
  note: string | null
  left: React.ReactNode
  below: React.ReactNode
  label: string
  /** Offered when the task was opened from the last step rather than reached in the walk. */
  onDone?: (() => void) | null
}): React.JSX.Element {
  const attempt = useTaskAttempt({ task, priorAttempts, onFinished, autoStart: true })
  return (
    <ChessStage
      className="cw-ac-stage"
      label={label}
      board={{
        fen: attempt.board.fen,
        orientation: attempt.board.orientation,
        interactive: attempt.board.interactive,
        onMove: attempt.board.onMove,
        highlight: attempt.board.highlight,
        lastMove: attempt.board.lastMove,
        showLegal: attempt.board.showLegal,
        label: attempt.board.label
      }}
      left={left}
      below={below}
      right={
        <div className="cw-ac-side">
          <TaskPanel attempt={attempt} countHinted={countHinted} note={note} priorAttempts={priorAttempts} />
          {onDone && <Button size="small" kind="quiet" onClick={onDone}>Back to where you stand</Button>}
        </div>
      }
    />
  )
}

export function LessonPlayer({
  node, reading, at, onPlace, onRead, onFinished, onBack, next, onNext, priorAttempts, notes
}: LessonPlayerProps): React.JSX.Element {
  const lesson = node.lesson
  const steps = useMemo(() => lessonSteps(lesson), [lesson])
  const last = steps.length - 1
  const [step, setStep] = useState(() => clampStep(stepOfBlock(at), steps))
  /** How far along a line to step through this step is, when the step is a line. */
  const [ply, setPly] = useState(0)
  /** A task opened from the last step, which the walk does not place here. */
  const [doing, setDoing] = useState<string | null>(null)

  const onPlaceRef = useRef(onPlace)
  onPlaceRef.current = onPlace
  const onReadRef = useRef(onRead)
  onReadRef.current = onRead

  // A different lesson opens at its own place.
  useEffect(() => {
    setStep(clampStep(stepOfBlock(at), steps))
    setDoing(null)
  }, [lesson.id, at, steps])

  const go = useCallback((to: number): void => {
    const next_ = clampStep(to, steps)
    setStep(next_)
    setPly(0)
    setDoing(null)
    onPlaceRef.current(blockOfStep(next_))
  }, [steps])

  // Time with the lesson open and the window in front. Nothing is counted while it is hidden.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      onReadRef.current(TICK_SECONDS)
    }, TICK_SECONDS * 1000)
    return () => window.clearInterval(timer)
  }, [lesson.id])

  const standing = node.standing
  const counted = useMemo(() => assessedTasks(lesson), [lesson])
  const outstanding = counted.filter((task) => standing.outstanding.includes(task.id))
  const here: LessonStep = steps[clampStep(step, steps)]
  const board = useMemo(() => boardForStep(lesson, step), [lesson, step])
  const walk = useMemo(() => walkLine(board.fen, board.moves), [board.fen, board.moves])
  const atPly = Math.max(0, Math.min(ply, walk.fens.length - 1))
  const taskOf = (id: string): Exercise | null => lesson.tasks.find((one) => one.id === id) ?? null

  /** Moving through the lesson from the keyboard, inside this screen only -- no second window listener. */
  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>): void => {
    const target = event.target as HTMLElement | null
    const tag = target?.tagName ?? ''
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
    const to = stepForKey(event.key, step, steps)
    if (to === null) return
    event.preventDefault()
    go(to)
  }, [step, steps, go])

  /** Down the left: every step of the lesson, always on screen, so nothing is hidden behind a Next button. */
  const outline = (
    <nav className="cw-ac-outline" aria-label="The steps of this lesson">
      <ol>
        {steps.map((one) => {
          const task = one.taskId === null ? null : taskOf(one.taskId)
          const done = task ? standing.tasks.find((two) => two.taskId === task.id)?.demonstrated === true : false
          return (
            <li key={one.index}>
              <button
                type="button"
                className={`cw-ac-outstep is-${one.kind}${one.index === step ? ' is-here' : ''}${done ? ' is-done' : ''}`}
                aria-current={one.index === step ? 'step' : undefined}
                onClick={() => go(one.index)}
                title={one.kind === 'task' ? 'A task. Doing it is what finishes the lesson.' : one.label}
              >
                <span className="cw-ac-outnum">{one.index + 1}</span>
                <span className="cw-ac-outlabel">{one.label}</span>
                {/* Never colour alone: a task says it is a task and a done one says it is done. */}
                {one.kind === 'task' && <span className="cw-ac-outtag">{done ? 'done' : 'task'}</span>}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )

  /** Under the board: what is on it, the line's own buttons, and the way through the lesson. */
  const below = (
    <div className="cw-ac-under">
      <p className="cw-ac-boardsays" role="status">
        {board.source === 'line' || board.source === 'carried'
          ? atPly === 0 ? board.says : `${board.says} After ${walk.san.slice(0, atPly).join(' ')}.`
          : board.says}
      </p>
      {board.moves.length > 0 && (
        <div className="cw-ac-row" role="group" aria-label="Step through the line">
          <Button size="tiny" disabled={atPly === 0} onClick={() => setPly(0)} aria-label="Back to the start of the line"><FirstIcon /></Button>
          <Button size="tiny" disabled={atPly === 0} onClick={() => setPly(atPly - 1)} aria-label="Back one move"><PrevIcon /></Button>
          <Button size="tiny" disabled={atPly >= walk.fens.length - 1} onClick={() => setPly(atPly + 1)} aria-label="On one move"><NextIcon /></Button>
          <Button size="tiny" disabled={atPly >= walk.fens.length - 1} onClick={() => setPly(walk.fens.length - 1)} aria-label="To the end of the line"><LastIcon /></Button>
          <span className="cw-ac-faint">{atPly} of {walk.fens.length - 1} moves</span>
        </div>
      )}
      {walk.broken && <p className="cw-ac-faulty" role="status">{walk.says}</p>}
      {board.arrows.length > 0 && (
        <ul className="cw-ac-arrowsays">
          {board.arrows.map((arrow) => (
            <li key={`${arrow.from}-${arrow.to}`}>{arrow.from} to {arrow.to}{arrow.says ? `: ${arrow.says}` : ''}</li>
          ))}
        </ul>
      )}
      {board.highlight.length > 0 && <p className="cw-ac-faint">Marked: {[...board.highlight].join(', ')}.</p>}
      <div className="cw-ac-walk" role="group" aria-label="Through the lesson">
        <Button size="small" disabled={step === 0} onClick={() => go(step - 1)}>Back</Button>
        <span className="cw-ac-faint">{stepWords(step, steps)}</span>
        <Button size="small" kind={step >= last ? 'normal' : 'primary'} disabled={step >= last} onClick={() => go(step + 1)}>
          {step === last - 1 ? 'Where do I stand?' : 'Next'}
        </Button>
      </div>
    </div>
  )

  /** Down the right: what this step of the lesson actually says. */
  const content = (
    <div className="cw-ac-side" aria-live="polite">
      {here.kind === 'intro' && (
        <section className="cw-ac-intro">
          <p>{lesson.intro}</p>
          <h4>Afterwards you should be able to</h4>
          <ul className="cw-ac-objectives">{lesson.objectives.map((one) => <li key={one}>{one}</li>)}</ul>
          {node.openBecause === 'skipped-past' && (
            <p className="cw-ac-note" role="status">
              This lesson is open because you marked what comes before it as already known, not because those
              lessons were finished.
            </p>
          )}
        </section>
      )}

      {here.block?.kind === 'heading' && <h4 className="cw-ac-h">{here.block.text}</h4>}
      {here.block?.kind === 'text' && <p className="cw-ac-text">{here.block.text}</p>}
      {here.block?.kind === 'list' && (
        here.block.ordered
          ? <ol className="cw-ac-list">{here.block.items.map((one) => <li key={one}>{one}</li>)}</ol>
          : <ul className="cw-ac-list">{here.block.items.map((one) => <li key={one}>{one}</li>)}</ul>
      )}
      {here.block?.kind === 'callout' && (
        <aside className={`cw-ac-callout is-${here.block.tone}`}>
          <strong>{here.block.tone === 'warning' ? 'Watch out' : here.block.tone === 'tip' ? 'Worth knowing' : 'Note'}</strong>
          <p>{here.block.text}</p>
        </aside>
      )}
      {here.block?.kind === 'table' && (
        <table className="cw-ac-table">
          <thead><tr>{here.block.headers.map((head) => <th key={head} scope="col">{head}</th>)}</tr></thead>
          <tbody>
            {here.block.rows.map((row, index) => (
              <tr key={`${row.join('|')}-${index}`}>{row.map((cell, column) => <td key={`${cell}-${column}`}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )}
      {here.block?.kind === 'board' && here.block.caption && <p className="cw-ac-text">{here.block.caption}</p>}
      {here.block?.kind === 'moves' && (
        <>
          {here.block.caption && <p className="cw-ac-text">{here.block.caption}</p>}
          <ol className="cw-ac-lineply" aria-label="The moves of this line">
            {walk.san.map((move, index) => (
              <li key={`${move}-${index}`}>
                <button
                  type="button"
                  className={index + 1 === atPly ? 'is-here' : ''}
                  aria-current={index + 1 === atPly ? 'true' : undefined}
                  onClick={() => setPly(index + 1)}
                >
                  {index % 2 === 0 ? `${Math.floor(index / 2) + 1}. ` : ''}{move}
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
      {here.block?.kind === 'task' && taskOf(here.block.taskId) === null && (
        <p className="cw-ac-faulty" role="status">
          This lesson asks for a task ({here.block.taskId}) that it does not contain, so there is nothing to do here.
        </p>
      )}

      {here.kind === 'assessment' && (
        <section className="cw-ac-assessment" aria-label="Where you stand">
          <h4>{lesson.assessment.title}</h4>
          <p className={standing.complete ? 'cw-ac-good' : 'cw-ac-plain'} role="status">{standing.says}</p>
          {!READING_COUNTS_TOWARD_COMPLETION && (
            <p className="cw-ac-faint">
              Reaching the end does not finish a lesson. It is finished when {standing.needs} of its{' '}
              {counted.length} tasks have been solved by you, with the answer not on screen.
            </p>
          )}
          <ul className="cw-ac-standings">
            {standing.tasks.map((one) => {
              const task = taskOf(one.taskId)
              const inAssessment = counted.some((two) => two.id === one.taskId)
              const where = stepOfTask(lesson, one.taskId)
              return (
                <li key={one.taskId} className={one.demonstrated ? 'is-done' : ''}>
                  <button
                    type="button"
                    className="cw-ac-standgo"
                    onClick={() => (where === null ? setDoing(one.taskId) : go(where))}
                    title="Put this task on the board"
                  >
                    {task?.prompt ?? one.taskId}
                  </button>
                  <span>{one.says}</span>
                  <small>
                    {one.attempts} {one.attempts === 1 ? 'go' : 'goes'}
                    {inAssessment ? '' : ' · not part of the assessment'}
                    {one.demonstrated && one.bestWorth < 1 ? ` · best ${Math.round(one.bestWorth * 100)}% of a clean solve` : ''}
                  </small>
                </li>
              )
            })}
          </ul>
          {outstanding.length > 0 && (
            <div className="cw-ac-row">
              <Button
                size="small"
                kind="primary"
                onClick={() => {
                  const where = stepOfTask(lesson, outstanding[0].id)
                  if (where === null) setDoing(outstanding[0].id)
                  else go(where)
                }}
              >
                Do the next one still outstanding
              </Button>
            </div>
          )}
          {standing.complete && node.unlocks.length > 0 && (
            <p className="cw-ac-note">
              Finishing this opened {node.unlocks.length} {node.unlocks.length === 1 ? 'lesson' : 'lessons'}.
            </p>
          )}
          <div className="cw-ac-row">
            {next && <Button size="small" kind="primary" onClick={() => onNext(next.lessonId)}>Next: {next.title}</Button>}
            <Button size="small" onClick={onBack}>Back to the course</Button>
          </div>
        </section>
      )}

      {/* Reading is shown as numbers. It is recorded and it finishes nothing, which the title says in four words. */}
      <div className="cw-ac-row cw-ac-readnote" aria-label="How much you have read this lesson">
        <span className="cw-ac-chip">Visits {reading.visits}</span>
        <span className="cw-ac-chip">{Math.round(reading.seconds / 60)} min open</span>
        <span className="cw-ac-faint" title="Reading is recorded for your own record and never counts toward finishing">Reading finishes nothing</span>
      </div>
    </div>
  )

  const openTask = doing !== null ? taskOf(doing) : here.taskId !== null ? taskOf(here.taskId) : null

  return (
    <article className="cw-ac-lesson" aria-label={lesson.title} onKeyDown={onKeyDown}>
      <header className="cw-ac-lessonhead">
        <Button size="tiny" kind="quiet" onClick={onBack}>← The course</Button>
        <h3>{lesson.title}</h3>
        <span className="cw-ac-crumb">{node.moduleTitle}</span>
        {/* The facts about the lesson, as chips rather than a sentence: they are four numbers, not a paragraph. */}
        <span className="cw-ac-chip" title="How long the lesson is written to take">{lesson.minutes} min</span>
        <span className="cw-ac-chip">{lesson.difficulty}</span>
        <span className="cw-ac-chip" title="Tasks demonstrated: solved by you with the answer not on screen">
          {standing.demonstrated.length}/{standing.needs} demonstrated
        </span>
        <span className="cw-ac-spacer" />
        <Button size="tiny" onClick={() => go(last)} title="The last step: which tasks are still outstanding">
          Where do I stand?
        </Button>
      </header>

      {openTask
        ? (
          <TaskStep
            key={openTask.id}
            task={openTask}
            priorAttempts={priorAttempts[openTask.id] ?? 0}
            countHinted={lesson.assessment.countHinted}
            onFinished={onFinished}
            note={notes[openTask.id] ?? null}
            left={outline}
            below={below}
            label={`${lesson.title}: ${openTask.prompt}`}
            onDone={doing === null ? null : () => setDoing(null)}
          />
        )
        : (
          <ChessStage
            className="cw-ac-stage"
            label={lesson.title}
            board={{
              fen: walk.fens[atPly],
              orientation: board.orientation,
              interactive: false,
              highlight: [...board.highlight],
              marks: marksFor(board.arrows),
              lastMove: atPly > 0
                ? { from: walk.uci[atPly - 1].slice(0, 2), to: walk.uci[atPly - 1].slice(2, 4) }
                : null,
              label: `${lesson.title}. ${board.says}`
            }}
            left={outline}
            below={below}
            right={content}
          />
        )}

      {/* With a task on the board the lesson's own words move under the outline, so both are still reachable. */}
      {openTask && (
        <details className="cw-ac-aside">
          <summary>What the lesson says here</summary>
          {content}
        </details>
      )}
    </article>
  )
}

export default LessonPlayer
