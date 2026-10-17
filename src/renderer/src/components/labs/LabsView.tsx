import { useEffect, useMemo, useRef, useState } from 'react'
import { FlaskConical, ChevronRight } from 'lucide-react'
import type { NoticeKind } from '../../lib/notices'
import { useSurface } from '../../lib/surfaces'
import { SearchBox, ViewHeader } from '../../ui'
import { labsCatalogueSurface } from './labsSurfaces'
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
  /** Other names for it: "projectile motion", "trajectory". What somebody actually types. */
  aliases: readonly string[]
  tags: readonly string[]
  limitations: readonly string[]
  /** The sentence saying it cannot open here, or null. */
  blocked: string | null
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
  onOpenApp,
  openInConversation
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
  /**
   * The laboratories already open in the conversation, by app id.
   *
   * Handed in because this screen cannot know: a laboratory lives in a card on a message, and the conversation is
   * the shell's. It is what makes "open the circuit laboratory" confirmable rather than merely issued -- the card
   * turning up in the conversation is the only reading that says it really opened.
   */
  openInConversation(): readonly string[]
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
      if ((one.aliases ?? []).some((alias) => alias.toLowerCase().includes(want))) return true
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

  /*
   * What the surface reads, kept in refs.
   *
   * A getter is asked at the moment somebody wants to know, including the moment just after something has been done
   * and before React has drawn. Reading `apps` and `query` straight out of this render would answer with a copy
   * taken before whatever was asked for happened.
   */
  const live = useRef({ apps, refused, query, groups })
  live.current = { apps, refused, query, groups }

  /*
   * Above the return and with no early return before it, because it is a hook.
   *
   * Every reader below is the screen's own state and every handler is the one its own control calls: the search box
   * and the card. Opening by name is matched against the same catalogue the screen draws.
   */
  useSurface(
    labsCatalogueSurface({
      catalogue: () => live.current.apps,
      refused: () => live.current.refused,
      search: () => live.current.query,
      setSearch: (text) => setQuery(text),
      matching: () => live.current.groups.flatMap((one) => one.apps),
      open: (appId) => {
        // The screen's own card handler, so a laboratory opened by Orbis opens exactly as one opened by hand.
        const found = (live.current.apps ?? []).find((one) => one.id === appId)
        if (found) open(found)
      },
      openHere: () => openInConversation(),
      close: onClose
    })
  )

  return (
    <section className="view labs-view" aria-label="Laboratories">
      <ViewHeader
        className="labs-head"
        icon={<FlaskConical size={17} aria-hidden />}
        title="Laboratories"
        note={
          apps === null
            ? 'Reading the catalogue…'
            : query.trim() === ''
              ? `${apps.length} of them, grouped by subject`
              : `${howMany} of ${apps.length} match`
        }
        search={
          <SearchBox
            value={query}
            onChange={setQuery}
            label="Search the laboratories"
            placeholder="Search by name, by subject, or by what you want to do…"
            inputRef={box}
            clearable
          />
        }
        onClose={onClose}
        closeLabel="Close the laboratories"
      />

      <div className="labs-body">
        {refused !== null && <p className="labs-refused">{refused}</p>}

        {apps !== null && howMany === 0 && refused === null && (
          <p className="view-empty">
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
