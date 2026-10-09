import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, FlaskConical, ChevronRight } from 'lucide-react'
import type { NoticeKind } from '../../lib/notices'
import './labs.css'

/**
 * Every laboratory Orbis has, as a screen rather than a popover.
 *
 * ## Why this exists
 *
 * There are more than sixty, and until now the only way to any of them was a small button in the chat header
 * that opens a search box. If you did not already know a laboratory existed you could not find it, which for
 * sixty-odd of them is most of the product being invisible.
 *
 * So this is the catalogue: grouped by subject, searchable, every one saying what it does and what it will not
 * do. The header button stays as the quick way in for somebody who knows what they want.
 *
 * ## It reads the registry rather than listing anything itself
 *
 * The list comes from the catalogue the main process holds, so a laboratory added tomorrow appears here without
 * this file changing — and one that has been retired does not appear at all, because `allApps` leaves it out.
 * Nothing here is written down twice.
 */

interface App {
  id: string
  name: string
  summary: string
  domain: string
  icon: string
  tags: readonly string[]
  limitations: readonly string[]
  opensAt: string
}

/** The subjects, in the order somebody would look for them rather than alphabetically. */
const SUBJECTS: readonly { id: string; label: string; about: string }[] = Object.freeze([
  { id: 'computing', label: 'Computing', about: 'Algorithms, machines, networks and the theory underneath' },
  { id: 'mathematics', label: 'Mathematics', about: 'Algebra, calculus, geometry and the numbers themselves' },
  { id: 'physics', label: 'Physics', about: 'Motion, waves, fields, matter and the universe' },
  { id: 'chemistry', label: 'Chemistry', about: 'Elements, reactions, structure and measurement' },
  { id: 'biology', label: 'Biology', about: 'Cells, populations and inheritance' },
  { id: 'engineering', label: 'Engineering', about: 'Circuits, control, structures and machines' },
  { id: 'data', label: 'Data', about: 'Importing, exploring, fitting and measuring' },
  { id: 'ai', label: 'Learning machines', about: 'Models, training and what they got wrong' },
  { id: 'systems', label: 'Systems', about: 'Processes, memory and the parts a computer is made of' },
  { id: 'creative', label: 'Making things', about: 'Documents, drawings and projects' },
  { id: 'study', label: 'Studying', about: 'Working through a problem and explaining it back' }
])

export default function LabsView({
  onClose,
  onNotify,
  onOpenApp
}: {
  onClose(): void
  onNotify(message: string, kind?: NoticeKind): void
  /**
   * Opens a laboratory.
   *
   * Handed in rather than called here, because opening one is more than registering an instance: a laboratory
   * lives in a card attached to a message, and the shell is what finds or starts the conversation, adds that
   * message and reports a reuse rather than adding a second card. Calling the API directly from here registered
   * the instance and put nothing on screen.
   */
  onOpenApp(appId: string): void
}): React.JSX.Element {
  const [apps, setApps] = useState<App[] | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [opening, setOpening] = useState<string | null>(null)
  const box = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const api = typeof window !== 'undefined' ? window.api : null
      if (!api || typeof api.native !== 'function') {
        if (alive) setRefused('The laboratories cannot be listed from here.')
        return
      }
      try {
        const got = (await api.native('catalogue')) as { apps?: App[] } | App[]
        const list = Array.isArray(got) ? got : (got?.apps ?? [])
        if (alive) setApps(list)
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error)
        if (!alive) return
        setRefused(why)
        // Worth interrupting for: the catalogue being unreadable is not a small thing.
        onNotify(`The laboratories could not be listed: ${why}`, 'warn')
      }
    })()
    return () => {
      alive = false
    }
  }, [onNotify])

  // Escape closes, and the search box takes focus so typing works at once.
  useEffect(() => {
    box.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (query !== '') {
        setQuery('')
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, query])

  const open = (app: App): void => {
    // The shell says what happened -- a refusal, a reuse, or the card appearing -- so nothing is reported twice.
    setOpening(app.id)
    onOpenApp(app.id)
    onClose()
  }

  /** What matches, and in which subject. Searching looks at the name, what it does and its tags. */
  const groups = useMemo(() => {
    if (!apps) return []
    const want = query.trim().toLowerCase()
    const matches = (one: App): boolean => {
      if (want === '') return true
      if (one.name.toLowerCase().includes(want)) return true
      if (one.summary.toLowerCase().includes(want)) return true
      return (one.tags ?? []).some((tag) => tag.toLowerCase().includes(want))
    }

    const found = apps.filter(matches)
    const out: { subject: { id: string; label: string; about: string }; apps: App[] }[] = []
    for (const subject of SUBJECTS) {
      const mine = found.filter((one) => one.domain === subject.id).sort((a, b) => a.name.localeCompare(b.name))
      if (mine.length > 0) out.push({ subject, apps: mine })
    }
    // A subject the registry has and this file does not know about still appears, rather than vanishing.
    const known = new Set(SUBJECTS.map((one) => one.id))
    const rest = found.filter((one) => !known.has(one.domain)).sort((a, b) => a.name.localeCompare(b.name))
    if (rest.length > 0) {
      out.push({ subject: { id: 'other', label: 'Everything else', about: '' }, apps: rest })
    }
    return out
  }, [apps, query])

  const howMany = groups.reduce((sum, one) => sum + one.apps.length, 0)

  return (
    <section className="view labs-view" aria-label="Laboratories">
      <header className="labs-head">
        <div className="labs-title">
          <FlaskConical size={17} aria-hidden />
          <div>
            <strong>Laboratories</strong>
            <span>
              {apps === null
                ? 'Reading the catalogue…'
                : query.trim() === ''
                  ? `${apps.length} of them, grouped by subject`
                  : `${howMany} of ${apps.length} match`}
            </span>
          </div>
        </div>

        <label className="labs-search">
          <Search size={14} aria-hidden />
          <input
            ref={box}
            type="search"
            value={query}
            placeholder="Search by name, by subject, or by what you want to do…"
            aria-label="Search the laboratories"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query !== '' && (
            <button type="button" aria-label="Clear the search" onClick={() => setQuery('')}>
              <X size={13} aria-hidden />
            </button>
          )}
        </label>

        <button type="button" className="icon-btn" aria-label="Close the laboratories" onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </header>

      <div className="labs-body">
        {refused !== null && <p className="labs-refused">{refused}</p>}

        {apps !== null && howMany === 0 && refused === null && (
          <p className="labs-none">
            Nothing matches “{query.trim()}”. Try a subject — physics, chemistry, computing — or what you want to
            do, like “sort” or “titration”.
          </p>
        )}

        {groups.map(({ subject, apps: mine }) => (
          <section key={subject.id} className="labs-group" aria-label={subject.label}>
            <h3>
              {subject.label}
              <span>
                {mine.length}
                {subject.about !== '' ? ` · ${subject.about}` : ''}
              </span>
            </h3>
            <div className="labs-grid">
              {mine.map((one) => (
                <button
                  key={one.id}
                  type="button"
                  className="labs-card"
                  disabled={opening !== null}
                  onClick={() => open(one)}
                >
                  <strong>{one.name}</strong>
                  <span className="labs-says">{one.summary}</span>
                  {/* What it will not do, because knowing that before opening it saves finding out after. */}
                  {one.limitations?.length > 0 && (
                    <span className="labs-wont">{one.limitations[0]}</span>
                  )}
                  <span className="labs-go">
                    {opening === one.id ? 'Opening…' : 'Open'} <ChevronRight size={13} aria-hidden />
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}
