import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../../ui'
import { ChessStage } from '../ChessStage'
import { arrowMark, type Mark } from '../../../../../shared/chess/marks'
import { boardForStep, lessonSteps } from '../../../../../shared/chess/lessonStage'
import type { AcademyMap, LessonNode, Resume, SkipPlan } from '../../../../../shared/chess/academyPath'

/**
 * The course: every lesson down the side, and the position the one you are looking at opens with on the board.
 *
 * ## Why there is a board on the course screen at all
 *
 * Because it is a chess screen. The course used to be seventeen cards of five lines each -- a state word, a reason,
 * a minutes-and-difficulty line, what it needs first, what it opens -- and no chess anywhere on it. Now the lessons
 * are a list down the left, and picking one puts the first position that lesson shows on the board. You can see
 * what a lesson is about before opening it, which is what a chess course map is for.
 *
 * ## Three states, never two
 *
 * Done, open and waiting are the obvious three. The fourth is the one that matters: **skipped**. A lesson somebody
 * marked as already known is open and has had nothing demonstrated in it, and it is counted as its own thing rather
 * than quietly rolled in with the finished ones. The counts say "6 done, 3 marked as already known" and never
 * "9 of 17".
 *
 * ## A locked lesson says what it is waiting for, by name
 *
 * Not "complete earlier lessons". The concepts, named as the curriculum names them -- and an offer to skip to it,
 * with what that would claim spelled out before it is claimed.
 *
 * ## Prove it instead
 *
 * Somebody who has played for years has a third option between grinding through the beginner lessons and declaring
 * they know them: open the lesson and do its tasks. That is what "Test me on it" does -- it is not a different
 * assessment, it is the lesson's own tasks, which is the only thing that was ever going to count.
 */

export interface CourseMapProps {
  map: AcademyMap
  resume: Resume
  onOpen: (lessonId: string) => void
  /** Open at the assessment rather than the first block. */
  onTest: (lessonId: string) => void
  onSkipTo: (lessonId: string) => void
  /** Worked out before it is done, so the button can say what it is about to claim. */
  planFor: (lessonId: string) => SkipPlan
  onUnskip: (lessonId: string) => void
}

function stateWord(node: LessonNode): string {
  if (node.state === 'done') return 'Done'
  if (node.state === 'skipped') return 'Marked as known'
  if (node.state === 'waiting') return 'Waiting'
  return node.standing.demonstrated.length > 0 ? 'Started' : 'Open'
}

/** The first position a lesson puts up, which is what its card on this screen shows. */
function previewOf(node: LessonNode): ReturnType<typeof boardForStep> {
  const steps = lessonSteps(node.lesson)
  const first = steps.find((one) => one.carriesBoard)
  return boardForStep(node.lesson, first ? first.index : 0)
}

function marksFor(arrows: readonly { from: string; to: string }[]): Mark[] {
  const made: Mark[] = []
  for (const arrow of arrows) {
    const mark = arrowMark(arrow.from, arrow.to, 'blue')
    if (mark) made.push(mark)
  }
  return made
}

export function CourseMap({ map, resume, onOpen, onTest, onSkipTo, planFor, onUnskip }: CourseMapProps): React.JSX.Element {
  const [asking, setAsking] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(resume.lessonId ?? map.nodes[0]?.lesson.id ?? null)
  const plan = asking === null ? null : planFor(asking)

  // Where to carry on from is the scheduler's answer and it can change; the pick follows it until somebody picks.
  useEffect(() => {
    if (picked === null && map.nodes.length > 0) setPicked(resume.lessonId ?? map.nodes[0].lesson.id)
  }, [picked, resume.lessonId, map.nodes])

  const node = map.nodes.find((one) => one.lesson.id === picked) ?? map.nodes[0] ?? null
  const board = useMemo(() => (node ? previewOf(node) : null), [node])

  if (!node || !board) {
    return (
      <div className="cw-ac-map">
        <p className="cw-ac-faulty" role="status">
          There are no lessons in this course, so there is nothing to show. That is a fault in the content, not in
          what you have done.
        </p>
      </div>
    )
  }

  const list = (
    <div className="cw-ac-courselist">
      <header>
        <h4>The course</h4>
        <p className="cw-ac-faint">{map.says}</p>
        <p className="cw-ac-faint">{map.open} open, {map.waiting} waiting on something.</p>
      </header>
      {map.modules.map((module) => (
        <section key={module.module.id} aria-label={module.module.title}>
          <h5 title={module.module.summary}>{module.module.title}</h5>
          <p className="cw-ac-faint">{module.says}</p>
          <ol>
            {module.lessons.map((one) => (
              <li key={one.lesson.id}>
                <button
                  type="button"
                  className={`cw-ac-courserow is-${one.state}${one.lesson.id === node.lesson.id ? ' is-here' : ''}`}
                  aria-current={one.lesson.id === node.lesson.id ? 'true' : undefined}
                  onClick={() => setPicked(one.lesson.id)}
                  title={one.says}
                >
                  <span className="cw-ac-pos">{one.position}</span>
                  <span className="cw-ac-courselabel">{one.lesson.title}</span>
                  {/* The state is a word as well as a tint, so it is not said by colour alone. */}
                  <span className={`cw-ac-state is-${one.state}`}>{stateWord(one)}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )

  const side = (
    <div className="cw-ac-side">
      <h4>{node.lesson.title}</h4>
      <p className="cw-ac-row">
        <span className={`cw-ac-state is-${node.state}`}>{stateWord(node)}</span>
        <span className="cw-ac-chip">{node.lesson.minutes} min</span>
        <span className="cw-ac-chip">{node.lesson.difficulty}</span>
        <span className="cw-ac-chip" title="Tasks demonstrated: solved by you with the answer not on screen">
          {node.tasks.demonstrated}/{node.tasks.assessed} demonstrated
          {node.standing.needs !== node.tasks.assessed ? ` (${node.standing.needs} needed)` : ''}
        </span>
      </p>
      <p className="cw-ac-text">{node.lesson.intro}</p>
      <h5>Afterwards you should be able to</h5>
      <ul className="cw-ac-objectives">{node.lesson.objectives.map((one) => <li key={one}>{one}</li>)}</ul>
      <p className="cw-ac-faint">{node.says}</p>
      {node.waitingOn.length > 0 && (
        <p className="cw-ac-faint">Needs first: {node.waitingOn.map((one) => one.name).join(', ')}.</p>
      )}
      {node.unlocks.length > 0 && node.state !== 'done' && (
        <p className="cw-ac-faint">
          Finishing it opens {node.unlocks.length} {node.unlocks.length === 1 ? 'lesson' : 'lessons'}.
        </p>
      )}

      {/*
        * Every button says which lesson it is about, out loud.
        *
        * The words on screen stay short, because the lesson's name is the heading right above them. But somebody
        * moving from button to button, or reading the screen out, needs to hear which lesson each belongs to.
        */}
      <div className="cw-ac-row">
        {node.open
          ? (
            <Button
              size="small"
              kind={node.state === 'done' ? 'normal' : 'primary'}
              onClick={() => onOpen(node.lesson.id)}
              aria-label={`${node.state === 'done' ? 'Open again' : node.standing.demonstrated.length > 0 ? 'Carry on with' : 'Open'}: ${node.lesson.title}`}
            >
              {node.state === 'done' ? 'Open again' : node.standing.demonstrated.length > 0 ? 'Carry on' : 'Open the lesson'}
            </Button>
          )
          : (
            <Button size="small" onClick={() => setAsking(node.lesson.id)} aria-label={`I already know this: ${node.lesson.title}`}>
              I already know this
            </Button>
          )}
        {node.state !== 'done' && node.tasks.assessed > 0 && (
          <Button
            size="small"
            kind="quiet"
            onClick={() => onTest(node.lesson.id)}
            aria-label={`Test me on: ${node.lesson.title}`}
            title="Opens the lesson at its tasks. Nothing else counts, so nothing else is offered."
          >
            Test me on it
          </Button>
        )}
        {node.state === 'skipped' && (
          <Button size="small" kind="quiet" onClick={() => onUnskip(node.lesson.id)} aria-label={`Unmark as already known: ${node.lesson.title}`}>
            Unmark it
          </Button>
        )}
      </div>

      {asking !== null && plan !== null && (
        <div className="cw-ac-asking" role="dialog" aria-label="Skip ahead">
          <h4>Skip ahead?</h4>
          <p>{plan.says}</p>
          {plan.lessonIds.length > 0 && (
            <ul className="cw-ac-list">
              {plan.lessonIds.map((id) => {
                const one = map.nodes.find((two) => two.lesson.id === id)
                return <li key={id}>{one?.lesson.title ?? id}</li>
              })}
            </ul>
          )}
          <p className="cw-ac-faint">
            They will show as marked as known, not as done, and nothing in them will count as demonstrated. You can
            unmark any of them afterwards, or do them properly at any time.
          </p>
          <div className="cw-ac-row">
            <Button
              size="small"
              kind="primary"
              disabled={plan.lessonIds.length === 0}
              onClick={() => { onSkipTo(asking); setAsking(null) }}
            >
              Mark them as known and open this lesson
            </Button>
            <Button size="small" kind="quiet" onClick={() => setAsking(null)}>Leave it</Button>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="cw-ac-map">
      <ChessStage
        className="cw-ac-stage"
        label={`${node.lesson.title}: the position it opens with`}
        board={{
          fen: board.fen,
          orientation: board.orientation,
          interactive: false,
          highlight: [...board.highlight],
          marks: marksFor(board.arrows),
          label: `${node.lesson.title}. ${board.says}`
        }}
        left={list}
        right={side}
        below={
          <div className="cw-ac-under">
            <p className="cw-ac-boardsays" role="status">{board.says}</p>
            <div className="cw-ac-row">
              {resume.lessonId !== null && (
                <Button size="small" kind="primary" onClick={() => onOpen(resume.lessonId as string)}>
                  {resume.kind === 'carry-on' ? 'Carry on where I left off' : 'Start the next lesson'}
                </Button>
              )}
              <span className="cw-ac-faint" role="status">{resume.says}</span>
            </div>
          </div>
        }
      />
    </div>
  )
}

export default CourseMap
