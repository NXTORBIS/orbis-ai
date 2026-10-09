import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Award, Check, ChevronRight, Lock, Play } from 'lucide-react'
import type { Course, Enrollment } from '../../../../shared/courses/types'
import type { NoticeKind } from '../../lib/notices'

/**
 * One course.
 *
 * ## It says what is left, not just what is done
 *
 * The certificate panel lists every unmet requirement in words, each with a way of dealing with it. A greyed-out
 * button with no explanation is the single most common way a learning platform loses somebody: they can see they
 * have not finished and cannot see why.
 *
 * ## The lesson count is whatever the course has
 *
 * Read from the course, every time. Nothing here assumes a course is a particular size.
 */

interface ModuleProgress {
  moduleId: string
  title: string
  lessons: number
  done: number
  share: number
  quizPassed: boolean
  quizBest: number
  state: 'not-started' | 'in-progress' | 'done'
}

interface Detail {
  course: Course
  enrollment: Enrollment | null
  progress: number
  modules: ModuleProgress[]
  next: { kind: string; id: string; title: string; says: string } | null
  xp: number
  certificate: { eligible: boolean; unmet: { what: string; says: string }[]; says: string } | null
  unmet: { what: string; says: string; action?: { id: string; label: string } }[]
  says: string | null
}

export default function CourseDetail({
  courseId,
  onBack,
  onLesson,
  onNotify
}: {
  courseId: string
  onBack(): void
  onLesson(lessonId: string): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [openModule, setOpenModule] = useState<string | null>(null)

  const load = useCallback(async () => {
    const out = (await window.api.courses('detail', courseId).catch(() => null)) as Detail | null
    setDetail(out)
    // A course updated under somebody mid-way says so once, rather than silently changing beneath them.
    if (out?.says) onNotify(out.says)
    if (out && !openModule) setOpenModule(out.course.modules[0]?.id ?? null)
  }, [courseId, onNotify, openModule])

  useEffect(() => {
    void load()
  }, [courseId])

  const start = async (): Promise<void> => {
    if (!detail) return
    await window.api.courses('enroll', courseId).catch(() => null)
    const next = detail.next?.kind === 'lesson' ? detail.next.id : detail.course.modules[0]?.lessons[0]?.id
    if (next) onLesson(next)
    else await load()
  }

  if (!detail) return <div className="co-loading" aria-label="Loading" />

  const { course, enrollment, modules } = detail
  const done = Math.round(detail.progress * 100)

  return (
    <div className="view co-view" role="region" aria-label={course.title}>
      <header className="co-head">
        <button type="button" className="co-back" onClick={onBack}>
          <ArrowLeft size={15} aria-hidden /> Courses
        </button>
      </header>

      <section className="co-hero">
        <div
          className="co-hero-cover"
          style={{ background: `linear-gradient(135deg, ${course.cover?.from || 'var(--cyan)'}, ${course.cover?.to || 'var(--surface)'})` }}
          aria-hidden
        />
        <div className="co-hero-body">
          <h2>{course.title}</h2>
          {course.subtitle ? <p className="co-sub">{course.subtitle}</p> : null}
          <p>{course.description || course.shortDescription}</p>
          <div className="co-chips">
            <span className="co-chip">{course.difficulty}</span>
            <span className="co-chip">
              {course.lessonCount} {course.lessonCount === 1 ? 'lesson' : 'lessons'}
            </span>
            <span className="co-chip">{course.moduleCount} modules</span>
            <span className="co-chip">{Math.round(course.estimatedMinutes / 6) / 10} hours</span>
            <span className="co-chip">{detail.xp} XP</span>
          </div>

          {enrollment ? (
            <>
              <span className="co-bar big" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={done}>
                <span style={{ width: `${done}%` }} />
              </span>
              <span className="co-faint">{done}% through</span>
            </>
          ) : null}

          <div className="co-actions">
            <button type="button" className="co-btn primary" onClick={() => void start()}>
              <Play size={15} aria-hidden /> {enrollment ? (detail.next?.kind === 'lesson' ? 'Continue' : 'Carry on') : 'Start the course'}
            </button>
            {detail.next ? <span className="co-faint">{detail.next.says}: {detail.next.title}</span> : null}
          </div>
        </div>
      </section>

      {course.objectives.length > 0 ? (
        <section aria-label="What you will be able to do">
          <h3>What you will be able to do</h3>
          <ul className="co-list">
            {course.objectives.map((one, index) => (
              <li key={index}>
                <Check size={14} aria-hidden /> {one}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {course.prerequisites.length > 0 ? (
        <section aria-label="Before you start">
          <h3>Before you start</h3>
          <ul className="co-list">
            {course.prerequisites.map((one, index) => (
              <li key={index}>{one}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Lessons">
        <h3>The course</h3>
        <ul className="co-modules">
          {course.modules.map((module) => {
            const progress = modules.find((one) => one.moduleId === module.id)
            const open = openModule === module.id
            return (
              <li key={module.id}>
                <button
                  type="button"
                  className={`co-module${open ? ' open' : ''}`}
                  aria-expanded={open}
                  onClick={() => setOpenModule(open ? null : module.id)}
                >
                  <ChevronRight size={15} aria-hidden className={open ? 'co-turn' : undefined} />
                  <span className="co-module-name">{module.title}</span>
                  <span className="co-faint">
                    {progress ? `${progress.done}/${module.lessons.length}` : `${module.lessons.length} lessons`}
                    {progress?.quizPassed ? ' · quiz passed' : ''}
                  </span>
                </button>
                {open ? (
                  <ul className="co-lessons">
                    {module.lessons.map((lesson) => {
                      const state = enrollment?.lessons.find((one) => one.lessonId === lesson.id)?.state
                      return (
                        <li key={lesson.id}>
                          <button type="button" className="co-lesson" onClick={() => onLesson(lesson.id)}>
                            <span className={`co-tick${state === 'done' ? ' done' : ''}`} aria-hidden>
                              {state === 'done' ? <Check size={12} /> : null}
                            </span>
                            <span className="co-lesson-name">{lesson.title}</span>
                            <span className="co-faint">{lesson.minutes} min</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      </section>

      {course.certificate ? (
        <section aria-label="Certificate">
          <h3>
            <Award size={15} aria-hidden /> Certificate
          </h3>
          {detail.certificate?.eligible ? (
            <p className="co-good">Everything is done. The certificate is yours.</p>
          ) : (
            <>
              <p className="co-faint">A certificate is issued when the course is genuinely finished. Still to do:</p>
              <ul className="co-list">
                {(detail.certificate?.unmet ?? detail.unmet).map((one, index) => (
                  <li key={index}>
                    <Lock size={13} aria-hidden /> {one.says}
                  </li>
                ))}
                {(detail.certificate?.unmet ?? detail.unmet).length === 0 ? <li>Start the course.</li> : null}
              </ul>
            </>
          )}
        </section>
      ) : null}
    </div>
  )
}
