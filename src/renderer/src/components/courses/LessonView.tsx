import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, FlaskConical, Lightbulb, Sparkles } from 'lucide-react'
import Quiz from './Quiz'
import { TEACH_LABELS, type Teach } from '../../../../shared/courses/orion'
import type { Block, Course, Lesson } from '../../../../shared/courses/types'
import type { NoticeKind } from '../../lib/notices'

/**
 * A lesson.
 *
 * ## The material is the page
 *
 * One column of content, and everything else out of the way until it is asked for. A lesson wrapped in panels,
 * sidebars and progress widgets is a lesson nobody reads — the thing being taught has to be the thing on screen.
 *
 * ## Orion is here, and knows where "here" is
 *
 * The teaching actions sit under the lesson and carry the course, module, lesson, concept and how the learner has
 * been doing. Asking "why is this negative?" works without saying which course it is about, which is the whole
 * point of building the context in the main process rather than pasting it into a prompt.
 *
 * ## Where somebody stopped is written down as they read
 *
 * Scrolling past a block records it. Closing Orbis mid-lesson and coming back puts them where they were.
 */

interface LessonPayload {
  course: Course
  lesson: Lesson
  moduleId: string | null
  atBlock: number
  ready: { ready: boolean; missing: { id: string; name: string }[]; says: string } | null
  offered: Teach[]
  mastery: { concept: string; name: string; says: string }[]
}

/**
 * The laboratory card.
 *
 * Pressing it opens the real laboratory, through the same opener the catalogue uses -- so a lesson that says
 * "change the learning rate and watch the error" sends you somewhere you can actually do that, rather than
 * describing it. The task is on the card, because a laboratory opened with nothing to do in it is a detour.
 */
function LabCard({ block, onOpen }: { block: Extract<Block, { kind: 'lab' }>; onOpen?: (appId: string) => void }): React.JSX.Element {
  return (
    <div className={`co-lab${block.optional ? ' is-optional' : ''}`}>
      <div className="co-lab-says">
        <strong>{block.title}</strong>
        <span>{block.does}</span>
        {block.optional && <em>Worth doing, not required to finish the lesson.</em>}
      </div>
      <button
        type="button"
        className="co-lab-go"
        disabled={onOpen === undefined}
        title={onOpen === undefined ? 'Laboratories cannot be opened from here.' : undefined}
        onClick={() => onOpen?.(block.appId)}
      >
        <FlaskConical size={14} aria-hidden /> Open it
      </button>
    </div>
  )
}

function Rendered({ block, onOpen }: { block: Block; onOpen?: (appId: string) => void }): React.JSX.Element | null {
  switch (block.kind) {
    case 'lab':
      return <LabCard block={block} {...(onOpen ? { onOpen } : {})} />
    case 'heading':
      return <h3 className="co-h">{block.text}</h3>
    case 'text':
      return <p className="co-p">{block.text}</p>
    case 'list':
      return block.ordered ? (
        <ol className="co-ol">
          {block.items.map((one, index) => (
            <li key={index}>{one}</li>
          ))}
        </ol>
      ) : (
        <ul className="co-ul">
          {block.items.map((one, index) => (
            <li key={index}>{one}</li>
          ))}
        </ul>
      )
    case 'callout':
      return (
        <aside className={`co-callout ${block.tone}`}>
          <p>{block.text}</p>
        </aside>
      )
    case 'example':
      return (
        <figure className="co-example">
          {block.title ? <figcaption>{block.title}</figcaption> : null}
          <p>{block.text}</p>
        </figure>
      )
    case 'code':
      return (
        <figure className="co-code">
          {/* Course content is shown as text, never run. A code block is something to read. */}
          <pre>
            <code>{block.code}</code>
          </pre>
          {block.caption ? <figcaption>{block.caption}</figcaption> : null}
        </figure>
      )
    case 'formula':
      return (
        <figure className="co-formula">
          <p>{block.latex}</p>
          {block.caption ? <figcaption>{block.caption}</figcaption> : null}
        </figure>
      )
    case 'table':
      return (
        <div className="co-table-wrap">
          <table className="co-table">
            <thead>
              <tr>
                {block.headers.map((one, index) => (
                  <th key={index}>{one}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'image':
      return (
        <figure className="co-figure">
          <img src={block.src} alt={block.alt} loading="lazy" />
          {block.caption ? <figcaption>{block.caption}</figcaption> : null}
        </figure>
      )
    case 'quote':
      return (
        <blockquote className="co-quote">
          <p>{block.text}</p>
          {block.from ? <cite>{block.from}</cite> : null}
        </blockquote>
      )
    default:
      return null
  }
}

export default function LessonView({
  courseId,
  lessonId,
  onBack,
  onLesson,
  onNotify,
  onOpenLab
}: {
  courseId: string
  lessonId: string
  onBack(): void
  onLesson(lessonId: string): void
  onNotify(message: string, kind?: NoticeKind): void
  /** Opens a laboratory named by a lesson. Absent when nothing can open one, and then the card says so. */
  onOpenLab?(appId: string): void
}): React.JSX.Element {
  const [payload, setPayload] = useState<LessonPayload | null>(null)
  const [asking, setAsking] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [quizzing, setQuizzing] = useState(false)
  const [finished, setFinished] = useState(false)
  const started = useRef(Date.now())
  const body = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const out = (await window.api.courses('lesson', courseId, lessonId).catch(() => null)) as LessonPayload | null
    setPayload(out)
    setSaid(null)
    setFinished(false)
    started.current = Date.now()
  }, [courseId, lessonId])

  useEffect(() => {
    void load()
  }, [load])

  /*
   * Where they have read to, written as they go.
   *
   * Throttled hard: this fires on every scroll, and a write per frame would be the one expensive thing in a
   * screen whose whole job is to be calm.
   */
  useEffect(() => {
    const element = body.current
    if (!element || !payload) return
    let last = 0
    const onScroll = (): void => {
      const now = Date.now()
      if (now - last < 4000) return
      last = now
      const blocks = [...element.querySelectorAll('[data-block]')]
      const seen = blocks.filter((one) => one.getBoundingClientRect().top < window.innerHeight * 0.6).length
      void window.api.courses('reading-at', courseId, lessonId, Math.max(0, seen - 1)).catch(() => undefined)
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [payload, courseId, lessonId])

  const ask = async (mode: Teach): Promise<void> => {
    if (!payload) return
    setAsking(true)
    setSaid(null)
    const context = (await window.api.courses('orion-context', courseId, lessonId, { mode, block: payload.atBlock }).catch(() => null)) as
      | { ask: string; state: string; material: string; summary: string }
      | null
    setAsking(false)
    if (!context) {
      onNotify('Orion could not be reached for this lesson.', 'warn')
      return
    }
    /*
     * The question goes to the chat, which is where Orion lives.
     *
     * The context is assembled in the main process and the material inside it is fenced, so a lesson can never
     * become a way of telling Orion what to do.
     */
    setSaid(`${TEACH_LABELS[mode]} — asked about ${context.summary}.`)
    window.dispatchEvent(new CustomEvent('orbis:ask-orion', { detail: { prompt: `${context.ask}\n\n${context.state}\n\n${context.material}` } }))
  }

  const finish = async (): Promise<void> => {
    const seconds = Math.round((Date.now() - started.current) / 1000)
    const out = (await window.api.courses('finish-lesson', courseId, lessonId, seconds).catch(() => null)) as
      | { xp: number; progress: number; next: { kind: string; id: string; title: string } }
      | null
    if (!out) return
    setFinished(true)
    onNotify(out.xp > 0 ? `Lesson done — ${out.xp} XP.` : 'Lesson done.')
    if (out.next?.kind === 'lesson' && out.next.id) onLesson(out.next.id)
    else if (out.next?.kind === 'quiz') setQuizzing(true)
    else onBack()
  }

  const checkpoints = useMemo(() => payload?.lesson.questions.filter((one) => payload.lesson.blocks.some((two) => two.kind === 'check' && two.questionId === one.id)) ?? [], [payload])

  if (!payload) return <div className="co-loading" aria-label="Loading" />
  const { lesson, course } = payload

  if (quizzing && payload.moduleId) {
    return (
      <Quiz
        courseId={courseId}
        scope={payload.moduleId}
        kind="quiz"
        title={`${course.modules.find((one) => one.id === payload.moduleId)?.title ?? 'Module'} quiz`}
        onNotify={onNotify}
        onDone={() => {
          setQuizzing(false)
          onBack()
        }}
        onBack={() => setQuizzing(false)}
      />
    )
  }

  return (
    <div className="view co-view co-lesson-view" role="region" aria-label={lesson.title}>
      <header className="co-head">
        <button type="button" className="co-back" onClick={onBack}>
          <ArrowLeft size={15} aria-hidden /> {course.title}
        </button>
        <span className="co-faint">{lesson.minutes} min · {lesson.difficulty}</span>
      </header>

      <div className="co-lesson-body" ref={body}>
        <h2>{lesson.title}</h2>
        {lesson.intro ? <p className="co-intro">{lesson.intro}</p> : null}

        {/* What this builds on, when some of it is shaky. Said, never used to block the lesson. */}
        {payload.ready && payload.ready.missing.length > 0 ? (
          <aside className="co-callout note">
            <p>{payload.ready.says}</p>
          </aside>
        ) : null}

        {lesson.objectives.length > 0 ? (
          <ul className="co-objectives">
            {lesson.objectives.map((one, index) => (
              <li key={index}>{one}</li>
            ))}
          </ul>
        ) : null}

        {lesson.blocks.map((block, index) => (
          <div key={index} data-block={index}>
            {block.kind === 'check' ? (
              <Quiz
                courseId={courseId}
                scope={lesson.id}
                kind="check"
                title="Quick check"
                only={[block.questionId]}
                questions={lesson.questions}
                onNotify={onNotify}
                onDone={() => undefined}
              />
            ) : (
              <Rendered block={block} {...(onOpenLab ? { onOpen: onOpenLab } : {})} />
            )}
          </div>
        ))}

        {/* Orion, under the material, knowing exactly where it is. */}
        <section className="co-orion" aria-label="Ask Orion about this">
          <h3>
            <Sparkles size={15} aria-hidden /> Stuck, or want more?
          </h3>
          <div className="co-teach">
            {payload.offered.map((one) => (
              <button key={one} type="button" className="co-btn small" disabled={asking} onClick={() => void ask(one)}>
                {one === 'hint' ? <Lightbulb size={13} aria-hidden /> : null}
                {TEACH_LABELS[one]}
              </button>
            ))}
          </div>
          {said ? <p className="co-faint">{said}</p> : null}
        </section>

        {checkpoints.length > 0 ? (
          <section className="co-checkpoint" aria-label="Before you move on">
            <h3>Before you move on</h3>
            <Quiz
              courseId={courseId}
              scope={lesson.id}
              kind="check"
              title=""
              questions={lesson.questions}
              only={checkpoints.map((one) => one.id)}
              onNotify={onNotify}
              onDone={() => undefined}
            />
          </section>
        ) : null}

        <div className="co-lesson-foot">
          <button type="button" className="co-btn primary" onClick={() => void finish()} disabled={finished}>
            <Check size={15} aria-hidden /> {finished ? 'Done' : 'I have finished this lesson'}
            <ArrowRight size={15} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  )
}
