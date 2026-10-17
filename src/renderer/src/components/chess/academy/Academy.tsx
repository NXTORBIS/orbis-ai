import { useCallback, useMemo, useState } from 'react'
import { Button, Segmented } from '../../../ui'
import type { NoticeKind } from '../../../lib/notices'
import { CourseMap } from './CourseMap'
import { LessonPlayer } from './LessonPlayer'
import { ReviewPanel } from './ReviewPanel'
import { useAcademyProgress } from './storage'
import { CHESS_CURRICULUM } from '../../../../../shared/chess/curriculum'
import {
  curriculumStanding, findTask, lessonsOf, validateCurriculum, verifyCurriculum, type Curriculum
} from '../../../../../shared/chess/lessons'
import type { Performance } from '../../../../../shared/chess/attempt'
import {
  academyMap, clearSkipped, conceptStandings, markSkipped, nodeFor, noteReading, openedLesson,
  recordAttempt, resumePoint, reviewToday, skipPlan
} from '../../../../../shared/chess/academyPath'
import './academy.css'
import { useSurface } from '../../../lib/surfaces'
import { simpleAreaSurface } from '../chessSurfaces'

/**
 * The Academy.
 *
 * Four places to be and one idea behind all of them: **a lesson is finished when its tasks have been demonstrated**.
 * Nothing on this screen moves a completion for any other reason -- not reading it, not reaching the end, not
 * marking it as already known, not opening it twice.
 *
 * ## What this file does and does not decide
 *
 * It decides nothing about chess, nothing about whether a task was solved, nothing about when something is due and
 * nothing about whether a lesson is open. Those answers come from `rules.ts`, `attempt.ts`, `spaced.ts` and
 * `lessons.ts` by way of `academyPath.ts`. What it owns is where you are, what is drawn, and when progress is
 * written down.
 *
 * ## The curriculum is verified once, here
 *
 * `curriculum.ts` hands out tasks stamped **unverified** on purpose: nothing may claim to have been checked without
 * being checked. So the content is put through `verifyCurriculum` once when the screen opens, and the result is what
 * every task on screen comes from. Alongside it `validateCurriculum` runs, and what it found is shown on the
 * Progress tab -- if a position in the content is wrong, the person is told rather than left to conclude they are
 * bad at chess.
 *
 * ## Progress lives in the profile
 *
 * One file, `personal/chess-academy.json`, through `chess:academy` and `chess:save-academy`. It used to be one key
 * in this window's own storage; `storage.tsx` says what that meant, how the old copy is brought across, and why what
 * comes back across the boundary is read against the curriculum here rather than in the store. The Progress tab says
 * where it is kept on screen rather than only in a comment.
 */

type Tab = 'course' | 'lesson' | 'review' | 'standing'

const TABS: { value: Tab; label: string }[] = [
  { value: 'course', label: 'The course' },
  { value: 'lesson', label: 'Lesson' },
  { value: 'review', label: 'Review' },
  { value: 'standing', label: 'Progress' }
]

/**
 * The content, checked, once per load of this module.
 *
 * Kept outside the component so switching tabs does not do it again, and lazy so importing this file does not do it
 * at all -- the check walks every task's solution tree, and no screen should pay for that until it opens.
 */
let prepared: { curriculum: Curriculum; problems: ReturnType<typeof validateCurriculum> } | null = null

function content(): { curriculum: Curriculum; problems: ReturnType<typeof validateCurriculum> } {
  if (prepared === null) {
    const now = Date.now()
    prepared = {
      curriculum: verifyCurriculum(CHESS_CURRICULUM, now),
      problems: validateCurriculum(CHESS_CURRICULUM, now)
    }
  }
  return prepared
}

export interface AcademyProps {
  /**
   * Say something in the window's own notice strip. Optional: everything the Academy has to say, it says on itself,
   * so a caller that has nowhere to put a notice loses nothing.
   */
  onNotify?: (text: string, kind?: NoticeKind) => void
}

export function Academy({ onNotify }: AcademyProps = {}): React.JSX.Element {
  const { curriculum, problems } = useMemo(() => content(), [])
  const { progress, update, latest, repaired, saveProblem, loading, carried, forget } = useAcademyProgress(curriculum)

  const [tab, setTab] = useState<Tab>('course')
  const [openId, setOpenId] = useState<string | null>(null)
  const [at, setAt] = useState(0)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [forgetting, setForgetting] = useState(false)

  const map = useMemo(() => academyMap(curriculum, progress.records, progress.skipped), [curriculum, progress])
  const resume = useMemo(() => resumePoint(curriculum, progress), [curriculum, progress])
  const today = useMemo(() => reviewToday(curriculum, progress, Date.now()), [curriculum, progress])
  const standing = useMemo(() => curriculumStanding(curriculum, progress.records), [curriculum, progress.records])
  const concepts = useMemo(() => conceptStandings(curriculum, progress.records, progress.skipped), [curriculum, progress])

  /** How many goes each task has had. Decides which defence a retry meets, and nothing else. */
  const priorAttempts = useMemo(() => {
    const counted: Record<string, number> = {}
    for (const record of progress.records) counted[record.exerciseId] = (counted[record.exerciseId] ?? 0) + 1
    return counted
  }, [progress.records])

  const openNode = nodeFor(map, openId)

  /** The next lesson after the open one that is open and not finished. */
  const after = useMemo(() => {
    if (!openNode) return null
    const index = map.nodes.findIndex((one) => one.lesson.id === openNode.lesson.id)
    const next = map.nodes.slice(index + 1).find((one) => one.state === 'open')
    return next ? { lessonId: next.lesson.id, title: next.lesson.title } : null
  }, [map, openNode])

  const open = useCallback((lessonId: string, block = 0): void => {
    const node = nodeFor(map, lessonId)
    if (!node) return
    if (!node.open) {
      onNotify?.(`${node.lesson.title} is still waiting on ${node.waitingOn.map((one) => one.name).join(', ')}.`, 'warn')
      return
    }
    update((held) => openedLesson(held, lessonId, Date.now()))
    setOpenId(lessonId)
    setAt(block)
    setTab('lesson')
  }, [map, update, onNotify])

  const carryOn = useCallback((): void => {
    if (resume.lessonId === null) return
    open(resume.lessonId, resume.block)
  }, [resume, open])

  /** Open a lesson at its assessment: its own tasks, which is the only thing that was ever going to count. */
  const test = useCallback((lessonId: string): void => {
    const node = nodeFor(map, lessonId)
    if (!node) return
    if (!node.open) {
      onNotify?.('That lesson is still waiting on something. Skip to it if you would rather not do what comes first.', 'warn')
      return
    }
    open(lessonId, node.lesson.blocks.length)
  }, [map, open, onNotify])

  const onFinished = useCallback((performance: Performance): void => {
    const task = findTask(curriculum, performance.exerciseId)
    if (!task) return
    const out = recordAttempt(latest(), task, performance, Date.now())
    update(() => out.progress)
    if (out.scheduled) {
      setNotes((held) => ({ ...held, [task.id]: out.scheduled?.says ?? '' }))
      if (out.scheduled.needsLesson) {
        onNotify?.('That one has gone wrong three times running. The lesson behind it is worth more than a fourth go.', 'warn')
      }
    }
  }, [curriculum, latest, update, onNotify])

  const onPlace = useCallback((block: number): void => {
    if (openId === null) return
    update((held) => noteReading(held, openId, { block }, Date.now()))
  }, [openId, update])

  const onRead = useCallback((seconds: number): void => {
    if (openId === null) return
    update((held) => noteReading(held, openId, { addSeconds: seconds }, Date.now()))
  }, [openId, update])

  const skipTo = useCallback((lessonId: string): void => {
    const plan = skipPlan(curriculum, lessonId, latest().records)
    update((held) => markSkipped(held, plan.lessonIds))
    onNotify?.(`${plan.lessonIds.length} marked as already known. They are open, not done.`)
    open(lessonId, 0)
  }, [curriculum, latest, update, onNotify, open])

  const unskip = useCallback((lessonId: string): void => {
    update((held) => clearSkipped(held, [lessonId]))
  }, [update])

  const minutesRead = Math.round(progress.reading.reduce((sum, one) => sum + one.seconds, 0) / 60)
  const faults = problems.problems.filter((one) => one.severity === 'fault')

  /*
   * What Orbis itself may do here: which part of the Academy is open.
   *
   * A lesson is opened by the course map itself, which decides what may be opened next; a control here that opened
   * any lesson at all would be a second opinion about that.
   */
  useSurface(
    simpleAreaSurface({
      id: 'academy',
      name: 'Academy',
      about: 'Lessons and tasks in an order that builds. Which lesson may be opened is the course map’s own decision.',
      keywords: ['academy', 'lessons', 'course', 'learn', 'curriculum', 'review'],
      controls: {
        tab: {
          name: 'What to show',
          spec: { type: 'string', description: TABS.map((one) => `${one.value} is ${one.label}`).join('; '), enum: TABS.map((one) => one.value) },
          get: () => tab,
          set: (value) => setTab(String(value) as Tab),
          default: 'course'
        }
      },
      state: () => ({
        tab,
        openLesson: openId,
        stillReading: loading,
        minutesRead,
        // Faults in the curriculum itself, which is a different thing from how somebody is getting on with it.
        curriculumFaults: faults.length
      })
    })
  )

  return (
    <div className="cw-ac-screen">
      <nav className="cw-ac-tabs" role="tablist" aria-label="The Academy">
        <Segmented
          value={tab}
          options={TABS.map((one) => ({
            value: one.value,
            label: one.label,
            ...(one.value === 'lesson' && openNode === null ? { disabled: true, why: 'Open a lesson from the course first.' } : {})
          }))}
          onChange={setTab}
          label="Which part of the Academy"
          className="cw-ac-tabs"
          optionClass="cw-ac-tab"
        />
      </nav>

      {(saveProblem || carried || repaired.length > 0) && (
        <div className="cw-ac-banner" role="status">
          {/* The store's own sentence, shown as it stands: it names what happened to the file and what was not done
              to it, and rewording it here would lose both. */}
          {saveProblem && <p>{saveProblem}</p>}
          {carried && <p>{carried}</p>}
          {repaired.length > 0 && (
            <>
              <p>Some of your saved progress could not be read. Everything that could be read was kept.</p>
              <ul>{repaired.map((one) => <li key={one}>{one}</li>)}</ul>
            </>
          )}
        </div>
      )}

      {/*
        * Three of the four tabs hold a board through `ChessStage`, which measures the room it is given. A box that
        * scrolls has no height to measure -- it is as tall as its content -- so those three get a box with a
        * definite height and no scrolling of its own, and only the writing beside the board scrolls. The Progress
        * tab is a page of figures and scrolls as a page.
        */}
      <div className={`cw-ac-body${tab === 'standing' ? '' : ' is-stage'}`}>
        {/* Not read yet. Nothing of the record is drawn: a course map with nothing finished on it is what somebody
            would see if their whole record had been lost, and one frame of that is not worth paying. */}
        {loading && <p className="cw-ac-faint" role="status">Reading what you have done so far…</p>}

        {!loading && tab === 'course' && (
          <CourseMap
            map={map}
            resume={resume}
            onOpen={(id) => (id === resume.lessonId ? carryOn() : open(id, 0))}
            onTest={test}
            onSkipTo={skipTo}
            planFor={(id) => skipPlan(curriculum, id, progress.records)}
            onUnskip={unskip}
          />
        )}

        {!loading && tab === 'lesson' && (
          openNode
            ? (
              <LessonPlayer
                key={openNode.lesson.id}
                node={openNode}
                reading={progress.reading.find((one) => one.lessonId === openNode.lesson.id)
                  ?? { lessonId: openNode.lesson.id, atBlock: 0, seconds: 0, visits: 0, firstAt: null, lastAt: null }}
                at={at}
                onPlace={onPlace}
                onRead={onRead}
                onFinished={onFinished}
                onBack={() => setTab('course')}
                next={after}
                onNext={(id) => open(id, 0)}
                priorAttempts={priorAttempts}
                notes={notes}
              />
            )
            : <p className="cw-ac-faint">No lesson is open. Pick one on the course.</p>
        )}

        {!loading && tab === 'review' && (
          <ReviewPanel
            today={today}
            onFinished={onFinished}
            onOpenLesson={(id) => open(id, 0)}
            notes={notes}
            priorAttempts={priorAttempts}
          />
        )}

        {!loading && tab === 'standing' && (
          <div className="cw-ac-standing">
            <section aria-label="Where you stand">
              <h3>Where you stand</h3>
              <ul className="cw-ac-facts">
                <li><strong>{map.done}</strong> lessons finished, of {map.total}</li>
                <li><strong>{map.skipped}</strong> marked as already known</li>
                <li><strong>{progress.records.length}</strong> attempts recorded</li>
                <li><strong>{minutesRead}</strong> minutes with a lesson open</li>
              </ul>
              <p className="cw-ac-faint">{standing.says}</p>
              <p
                className="cw-ac-faint"
                title={'Finished means its tasks were demonstrated: solved by you, with the answer not on screen. '
                  + 'Minutes with a lesson open is time this window was in front with the lesson on it. It is '
                  + 'recorded because it is worth knowing, and it moves nothing.'}
              >
                Finished means demonstrated, not read.
              </p>
            </section>

            <section aria-label="Concepts">
              <h4>Concepts</h4>
              <ul className="cw-ac-concepts">
                {concepts.map((one) => (
                  <li key={one.concept.id} className={one.taught ? 'is-taught' : one.credited ? 'is-credited' : ''}>
                    <strong>{one.concept.name}</strong>
                    <span>{one.says}</span>
                  </li>
                ))}
              </ul>
              <p className="cw-ac-faint" title="Nothing here measures how good you are at chess, and nothing here claims to.">
                Counts of what was demonstrated, not a score.
              </p>
            </section>

            <section aria-label="The content">
              <h4>The content</h4>
              <p className="cw-ac-faint">
                {curriculum.title} — version {curriculum.version}. {lessonsOf(curriculum).length} lessons,{' '}
                {problems.counted.tasks} tasks, of which {problems.counted.verified} were checked against the rules
                just now{problems.counted.rejected > 0 ? `, and ${problems.counted.rejected} did not pass` : ''}.
              </p>
              {progress.curriculumVersion !== curriculum.version && (
                <p className="cw-ac-note">
                  What you have done was recorded against version {progress.curriculumVersion} of these lessons. The
                  lessons are now at version {curriculum.version}, so a lesson you finished may have changed since.
                </p>
              )}
              {faults.length > 0 && (
                <>
                  <p className="cw-ac-faulty">
                    {faults.length} {faults.length === 1 ? 'problem was' : 'problems were'} found in the lessons
                    themselves. They are shown here rather than hidden, because a wrong task teaches somebody that
                    they cannot do something they can.
                  </p>
                  <ul className="cw-ac-faults">
                    {faults.slice(0, 20).map((one, index) => (
                      <li key={`${one.code}-${one.lessonId ?? ''}-${index}`}>
                        {one.lessonId ? `${one.lessonId}: ` : ''}{one.says}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section aria-label="Where this is kept">
              <h4>Where this is kept</h4>
              <p
                className="cw-ac-faint"
                title={'One file with your profile, so it follows the profile rather than this computer, two people '
                  + 'with their own profiles keep their own record, and it travels in a profile export. Anything '
                  + "from before this changed was brought across once from this window's own storage, and the old "
                  + 'copy was left where it is.'}
              >
                With your profile, in one file of its own.
              </p>
              <div className="cw-ac-row">
                {forgetting
                  ? (
                    <>
                      <Button size="small" kind="danger" onClick={() => { forget(); setNotes({}); setOpenId(null); setForgetting(false); setTab('course') }}>
                        Yes, forget all {progress.records.length} attempts
                      </Button>
                      <Button size="small" kind="quiet" onClick={() => setForgetting(false)}>Keep them</Button>
                    </>
                  )
                  : <Button size="small" onClick={() => setForgetting(true)}>Forget everything I have done</Button>}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

export default Academy
