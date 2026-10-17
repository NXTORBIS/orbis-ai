import { useEffect, useMemo, useState } from 'react'
import { Button, EmptyState } from '../../../ui'
import { ChessStage } from '../ChessStage'
import { TaskPanel } from './TaskPanel'
import { useTaskAttempt } from './useTaskAttempt'
import type { Performance } from '../../../../../shared/chess/attempt'
import type { DueItem, ReviewToday } from '../../../../../shared/chess/academyPath'

/**
 * What is due today, on the board.
 *
 * ## Why it is a board and not a list of cards
 *
 * It was a list: three sections of rows, each row a prompt and a sentence, and a task opened inside its own row
 * with a board about a third of the width of the column. So the screen that exists for practising positions showed
 * no position until something was opened, and then showed a small one. Now the queue is the column on the left, the
 * position of whatever is picked is on the board in the middle at the size the room allows, and the controls for it
 * are the column on the right. Picking something in the queue changes what is on the board.
 *
 * ## The schedule is not worked out here
 *
 * `spaced.ts` decides when something comes back, over the scheduler the rest of Orbis uses. This screen asks what
 * is due and draws the answer. There is no second opinion about intervals anywhere in the Academy. Whose scheduler
 * it is, and what it cannot do, is on the screen rather than behind a tooltip -- short, and in the place it applies.
 *
 * ## Three wrong in a row is not a fourth guess
 *
 * A card that keeps going wrong is pulled out of the queue into its own group, with the lesson behind it offered
 * instead. That rule lives in `spaced.ts`; this draws the separation rather than flattening it into one list.
 *
 * ## Nothing here claims mastery
 *
 * Every figure is a count with the number of attempts beside it. A theme with four attempts behind it says so
 * instead of reading as a percentage, because `themeStandings` refuses to pretend four is a sample.
 */

export interface ReviewPanelProps {
  today: ReviewToday
  onFinished: (performance: Performance) => void
  /** Open the lesson a task came from. */
  onOpenLesson: (lessonId: string) => void
  /** What the scheduler said about the last attempt at each task. */
  notes: Readonly<Record<string, string>>
  priorAttempts: Readonly<Record<string, number>>
}

type Group = 'teach' | 'review' | 'fresh'

const GROUP_WORD: Record<Group, string> = {
  teach: 'Worth the lesson',
  review: 'Due',
  fresh: 'Not tried yet'
}

/** Everything in the queue, in the order the scheduler puts it: what keeps failing, then due, then new. */
function queueOf(today: ReviewToday): { group: Group; item: DueItem }[] {
  return [
    ...today.teach.map((item) => ({ group: 'teach' as Group, item })),
    ...today.review.map((item) => ({ group: 'review' as Group, item })),
    ...today.fresh.map((item) => ({ group: 'fresh' as Group, item }))
  ]
}

/** The picked item, on the board, with its own controls beside it. */
function DueStage({
  item, group, priorAttempts, onFinished, note, onOpenLesson, left
}: {
  item: DueItem
  group: Group
  priorAttempts: number
  onFinished: (performance: Performance) => void
  note: string | null
  onOpenLesson: (lessonId: string) => void
  left: React.ReactNode
}): React.JSX.Element {
  // Not started on its own: the position is on the board to be looked at first, and the clock starts when asked.
  const attempt = useTaskAttempt({ task: item.task, priorAttempts, onFinished })
  return (
    <ChessStage
      className="cw-ac-stage"
      label={item.task.prompt}
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
      below={
        <div className="cw-ac-under">
          <p className="cw-ac-boardsays" role="status">{item.why}</p>
          {group === 'teach' && (
            <p className="cw-ac-note">
              This one has gone wrong three times running. The lesson behind it is worth more than a fourth go.
            </p>
          )}
          <div className="cw-ac-row">
            <Button size="small" onClick={() => onOpenLesson(item.lesson.id)}>Open the lesson: {item.lesson.title}</Button>
            {item.task.tags.length > 0 && <span className="cw-ac-faint">Trains: {[...item.task.tags].join(', ')}.</span>}
          </div>
        </div>
      }
      right={
        <div className="cw-ac-side">
          <TaskPanel
            attempt={attempt}
            countHinted={item.lesson.assessment.countHinted}
            note={note}
            priorAttempts={priorAttempts}
          />
        </div>
      }
    />
  )
}

export function ReviewPanel({ today, onFinished, onOpenLesson, notes, priorAttempts }: ReviewPanelProps): React.JSX.Element {
  const queue = useMemo(() => queueOf(today), [today])
  const [picked, setPicked] = useState<string | null>(queue.length > 0 ? queue[0].item.task.id : null)
  const ids = queue.map((one) => one.item.task.id).join(',')

  // What is due changes under the screen as attempts are recorded, so a pick that is no longer there moves on.
  useEffect(() => {
    if (queue.length === 0) {
      if (picked !== null) setPicked(null)
      return
    }
    if (picked === null || !queue.some((one) => one.item.task.id === picked)) setPicked(queue[0].item.task.id)
    // Depends on the ids rather than the array, which `queueOf` rebuilds on every render.
  }, [ids, queue, picked])

  const here = queue.find((one) => one.item.task.id === picked) ?? null

  const list = (
    <div className="cw-ac-queue">
      <header>
        <h4>Today</h4>
        <p className="cw-ac-faint" role="status">{today.says}</p>
        <p className="cw-ac-faint" title={`${today.scheduler.origin} What it cannot do: ${today.scheduler.limitation}`}>
          Scheduled by {today.scheduler.label}.
        </p>
      </header>
      {(['teach', 'review', 'fresh'] as Group[]).map((group) => {
        const rows = queue.filter((one) => one.group === group)
        if (rows.length === 0) return null
        return (
          <section key={group} aria-label={GROUP_WORD[group]}>
            <h5>{GROUP_WORD[group]} ({rows.length})</h5>
            <ul>
              {rows.map((row) => (
                <li key={row.item.task.id}>
                  <button
                    type="button"
                    className={`cw-ac-queuerow is-${group}${row.item.task.id === picked ? ' is-here' : ''}`}
                    aria-current={row.item.task.id === picked ? 'true' : undefined}
                    onClick={() => setPicked(row.item.task.id)}
                    title={row.item.why}
                  >
                    <span className="cw-ac-queueprompt">{row.item.task.prompt}</span>
                    <span className="cw-ac-queuelesson">{row.item.lesson.title}</span>
                    {/* The group is said in words on the row, not only in the colour of its edge. */}
                    <span className="cw-ac-outtag">{GROUP_WORD[group]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      {today.themes.length > 0 && (
        <section aria-label="How the themes are going">
          <h5>By theme</h5>
          {today.weakest.length > 0 && (
            <p className="cw-ac-note">
              Tried enough to mean something and going badly: {today.weakest.map((one) => one.theme).join(', ')}.
            </p>
          )}
          <ul className="cw-ac-themes">
            {today.themes.map((one) => (
              <li key={one.theme}>
                <strong>{one.theme}</strong>
                <span>{one.says}</span>
                {one.dueNow > 0 && <small>{one.dueNow} due now</small>}
              </li>
            ))}
          </ul>
          <p className="cw-ac-faint">A share with few attempts behind it is not a measurement, and is not shown as one.</p>
        </section>
      )}
    </div>
  )

  if (queue.length === 0 || here === null) {
    return (
      <div className="cw-ac-review">
        <EmptyState>
          Nothing is due. Due means due: a queue that always has something in it is a queue that has stopped meaning
          anything.
        </EmptyState>
        <p className="cw-ac-faint">Scheduled by {today.scheduler.label}. {today.scheduler.origin}</p>
        <p className="cw-ac-faint">What it cannot do: {today.scheduler.limitation}</p>
      </div>
    )
  }

  return (
    <div className="cw-ac-review">
      <DueStage
        key={here.item.task.id}
        item={here.item}
        group={here.group}
        priorAttempts={priorAttempts[here.item.task.id] ?? here.item.card.attempts}
        onFinished={onFinished}
        note={notes[here.item.task.id] ?? null}
        onOpenLesson={onOpenLesson}
        left={list}
      />
    </div>
  )
}

export default ReviewPanel
