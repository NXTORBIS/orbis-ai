import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { GraduationCap, Play, Search, X } from 'lucide-react'
import type { CourseCard } from '../../../../shared/courses/types'
import type { NoticeKind } from '../../lib/notices'
import './courses.css'

const CourseDetail = lazy(() => import('./CourseDetail'))
const LessonView = lazy(() => import('./LessonView'))

/**
 * Courses.
 *
 * ## Three things, and that is the whole shelf
 *
 * Continue, a few recommendations, and what is yours. Everything underneath — mastery, the concept graph,
 * spaced revision, adaptive difficulty, the assessment engine — never appears here. A learning platform that
 * opens on a wall of statistics is one people close again, and none of those numbers tells somebody what to do
 * next, which is the only question the shelf exists to answer.
 *
 * ## The lesson is the product
 *
 * Everything on this screen is a route into a lesson. Nothing here is a destination.
 */

type Where = { kind: 'shelf' } | { kind: 'course'; courseId: string } | { kind: 'lesson'; courseId: string; lessonId: string }

interface Shelf {
  continuing: CourseCard[]
  recommended: CourseCard[]
  mine: CourseCard[]
  all: CourseCard[]
}

const minutes = (total: number): string => {
  if (total < 60) return `${total} min`
  const hours = Math.round(total / 6) / 10
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

function Cover({ card, size = 'normal' }: { card: CourseCard; size?: 'normal' | 'wide' }): React.JSX.Element {
  const from = card.cover?.from || 'var(--cyan)'
  const to = card.cover?.to || 'var(--surface)'
  return (
    <div className={`co-cover${size === 'wide' ? ' wide' : ''}`} style={{ background: `linear-gradient(135deg, ${from}, ${to})` }} aria-hidden>
      <GraduationCap size={size === 'wide' ? 26 : 20} />
    </div>
  )
}

function Card({ card, onOpen }: { card: CourseCard; onOpen(): void }): React.JSX.Element {
  return (
    <button type="button" className="co-card" onClick={onOpen}>
      <Cover card={card} />
      <div className="co-card-body">
        <strong>{card.title}</strong>
        <p>{card.shortDescription}</p>
        <span className="co-faint">
          {/* Counted from the course itself, so a course with eighteen lessons says eighteen. */}
          {card.lessonCount} {card.lessonCount === 1 ? 'lesson' : 'lessons'} · {minutes(card.estimatedMinutes)} · {card.difficulty}
        </span>
        {card.enrolled ? (
          <span className="co-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(card.progress * 100)}>
            <span style={{ width: `${Math.round(card.progress * 100)}%` }} />
          </span>
        ) : null}
      </div>
    </button>
  )
}

export default function CoursesView({
  onClose,
  onNotify,
  onOpenApp
}: {
  onClose(): void
  onNotify(message: string, kind?: NoticeKind): void
  /** Opens a laboratory a lesson names, through the shell -- the same route the catalogue takes. */
  onOpenApp?(appId: string): void
}): React.JSX.Element {
  const [shelf, setShelf] = useState<Shelf | null>(null)
  const [where, setWhere] = useState<Where>({ kind: 'shelf' })
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    const out = (await window.api.courses('shelf').catch(() => null)) as Shelf | null
    setShelf(out)
  }, [])

  useEffect(() => {
    void load()
  }, [load, where])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      event.preventDefault()
      // Escape goes back one step rather than closing everything, so a lesson is never lost by accident.
      if (where.kind === 'lesson') setWhere({ kind: 'course', courseId: where.courseId })
      else if (where.kind === 'course') setWhere({ kind: 'shelf' })
      else onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [where, onClose])

  if (where.kind === 'lesson') {
    return (
      <Suspense fallback={<div className="co-loading" />}>
        <LessonView
          {...(onOpenApp
            ? {
                onOpenLab: (appId: string) => {
                  // The laboratory opens in the conversation, so the course screen gets out of the way.
                  onOpenApp(appId)
                  onClose()
                }
              }
            : {})}
          courseId={where.courseId}
          lessonId={where.lessonId}
          onNotify={onNotify}
          onBack={() => setWhere({ kind: 'course', courseId: where.courseId })}
          onLesson={(lessonId) => setWhere({ kind: 'lesson', courseId: where.courseId, lessonId })}
        />
      </Suspense>
    )
  }

  if (where.kind === 'course') {
    return (
      <Suspense fallback={<div className="co-loading" />}>
        <CourseDetail
          courseId={where.courseId}
          onNotify={onNotify}
          onBack={() => setWhere({ kind: 'shelf' })}
          onLesson={(lessonId) => setWhere({ kind: 'lesson', courseId: where.courseId, lessonId })}
        />
      </Suspense>
    )
  }

  const searching = query.trim().length > 1
  const found = searching
    ? (shelf?.all ?? []).filter(
        (one) =>
          one.title.toLowerCase().includes(query.toLowerCase()) ||
          one.tags.some((two) => two.toLowerCase().includes(query.toLowerCase())) ||
          one.category.toLowerCase().includes(query.toLowerCase())
      )
    : []

  const nothingAtAll = shelf !== null && shelf.all.length === 0

  return (
    <div className="view co-view" role="region" aria-label="Courses">
      <header className="co-head">
        <div>
          <h2>Courses</h2>
          <p className="co-faint">Structured learning, with everything you do actually measured.</p>
        </div>
        <div className="co-head-right">
          <label className="co-search">
            <Search size={15} aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value.slice(0, 120))}
              placeholder="Find a course"
              aria-label="Find a course"
            />
          </label>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close Courses">
            <X size={16} aria-hidden />
          </button>
        </div>
      </header>

      {shelf === null ? <div className="co-loading" aria-label="Loading" /> : null}

      {nothingAtAll ? (
        /* Said plainly. An empty shelf is a state, not a failure, and it says what would change it. */
        <p className="co-empty">
          No courses are installed yet. A course is a file Orbis checks before it will teach it — once one is added it
          appears here with its real lesson count.
        </p>
      ) : null}

      {searching ? (
        <section aria-label="Search results">
          <h3>{found.length} found</h3>
          <div className="co-grid">
            {found.map((one) => (
              <Card key={one.id} card={one} onOpen={() => setWhere({ kind: 'course', courseId: one.id })} />
            ))}
          </div>
          {found.length === 0 ? <p className="co-empty">Nothing matches that.</p> : null}
        </section>
      ) : (
        <>
          {shelf && shelf.continuing.length > 0 ? (
            <section aria-label="Continue learning">
              <h3>Continue</h3>
              {shelf.continuing.map((one) => (
                <button key={one.id} type="button" className="co-continue" onClick={() => setWhere({ kind: 'course', courseId: one.id })}>
                  <Cover card={one} size="wide" />
                  <div>
                    <strong>{one.title}</strong>
                    <span className="co-faint">
                      {Math.round(one.progress * 100)}% through · {one.nextUp ?? 'Ready'}
                    </span>
                    <span className="co-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(one.progress * 100)}>
                      <span style={{ width: `${Math.round(one.progress * 100)}%` }} />
                    </span>
                  </div>
                  <span className="co-go">
                    <Play size={15} aria-hidden /> Continue
                  </span>
                </button>
              ))}
            </section>
          ) : null}

          {shelf && shelf.recommended.length > 0 ? (
            <section aria-label="Recommended">
              <h3>Worth a look</h3>
              <div className="co-grid">
                {shelf.recommended.map((one) => (
                  <Card key={one.id} card={one} onOpen={() => setWhere({ kind: 'course', courseId: one.id })} />
                ))}
              </div>
            </section>
          ) : null}

          {shelf && shelf.mine.length > 0 ? (
            <section aria-label="My courses">
              <h3>Yours</h3>
              <div className="co-grid">
                {shelf.mine.map((one) => (
                  <Card key={one.id} card={one} onOpen={() => setWhere({ kind: 'course', courseId: one.id })} />
                ))}
              </div>
            </section>
          ) : null}

          {shelf && shelf.all.length > 0 && shelf.mine.length === 0 ? (
            <section aria-label="All courses">
              <h3>Everything</h3>
              <div className="co-grid">
                {shelf.all.map((one) => (
                  <Card key={one.id} card={one} onOpen={() => setWhere({ kind: 'course', courseId: one.id })} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}
