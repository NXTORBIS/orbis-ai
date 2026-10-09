import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Search } from 'lucide-react'
import { appIcon } from './icons'
import './native.css'

/**
 * Search Labs.
 *
 * ## Small on purpose
 *
 * A popover on the composer, not a page, not a dashboard, not a marketplace. The brief is explicit that the manual
 * discovery route stays tiny, and the reason is that Orion is the main entrance: somebody who says "simulate a
 * projectile" should never have to walk Physics → Mechanics → Projectile Motion. This exists for the times they would
 * rather look.
 *
 * ## It searches the same index Orion does
 *
 * One call, `native('find')`, which is the same function the Orion bridge resolves through. Two search surfaces over
 * two lists is how a result appears here that nothing can open — which is exactly the failure the browser panel had,
 * where eighteen rows rendered as live because nothing ever asked whether their destination existed.
 *
 * ## A row that cannot open says so, here, before it is clicked
 *
 * `blocked` comes back from the registry with a reason in words. The row is still shown — hiding it would leave
 * somebody searching for something that exists — and it is not clickable.
 */

export interface LabRow {
  id: string
  name: string
  summary: string
  domain: string
  icon: string
  because: string
  blocked: string | null
  lastUsed: number | null
  opensAt: 'compact' | 'expanded' | 'workspace'
}

export default function SearchLabs({
  onOpen,
  onClose,
  placement
}: {
  onOpen(appId: string): void
  onClose(): void
  placement: { down: boolean; offset: number; maxHeight: number }
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<LabRow[]>([])
  const [recent, setRecent] = useState<string[]>([])
  const [at, setAt] = useState(0)
  const [loading, setLoading] = useState(true)
  const input = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  /*
   * Focus the search as it opens, and again once the frame has settled.
   *
   * Once is not enough. The composer focuses its textarea from several of its own effects, and this popover arrives
   * from a lazy chunk, so whichever lands last wins -- which made the focus work on one run and not the next. Two
   * attempts and then a short re-check beats a late competing focus without fighting it for ever, and each one stops
   * if the focus has already been given to something else deliberately.
   */
  useEffect(() => {
    let cancelled = false
    const take = (): void => {
      if (cancelled) return
      const element = input.current
      if (!element || document.activeElement === element) return
      element.focus()
    }
    take()
    const frame = requestAnimationFrame(take)
    const timer = setTimeout(take, 120)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [])

  const load = useCallback(async (text: string) => {
    setLoading(true)
    const [found, used] = await Promise.all([
      window.api.native('find', text).catch(() => []) as Promise<LabRow[]>,
      window.api.native('recent').catch(() => []) as Promise<{ id: string }[]>
    ])
    setRows(Array.isArray(found) ? found : [])
    setRecent(Array.isArray(used) ? used.map((one) => one.id) : [])
    setAt(0)
    setLoading(false)
  }, [])

  useEffect(() => {
    // Debounced, because this runs on every keystroke and the ranking is over the whole catalogue.
    const timer = setTimeout(() => void load(query), query ? 90 : 0)
    return () => clearTimeout(timer)
  }, [query, load])

  const openable = useMemo(() => rows.filter((one) => one.blocked === null), [rows])

  const groups = useMemo(() => {
    if (query.trim().length > 0) return [{ label: `${rows.length} found`, rows }] as const
    const recentRows = rows.filter((one) => recent.includes(one.id)).slice(0, 4)
    const taken = new Set(recentRows.map((one) => one.id))
    const suggested = rows.filter((one) => !taken.has(one.id)).slice(0, 8)
    return [
      ...(recentRows.length > 0 ? ([{ label: 'Recently used', rows: recentRows }] as const) : []),
      { label: recentRows.length > 0 ? 'Worth a look' : 'Labs', rows: suggested }
    ] as const
  }, [query, rows, recent])

  /** Flattened, so arrow keys move through the list the way it looks rather than the way it is grouped. */
  const flat = useMemo(() => groups.flatMap((one) => one.rows), [groups])

  const choose = useCallback(
    (row: LabRow | undefined) => {
      if (!row || row.blocked !== null) return
      onOpen(row.id)
      onClose()
    },
    [onOpen, onClose]
  )

  const onKey = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setAt((held) => {
        if (flat.length === 0) return 0
        const next = (held + step + flat.length) % flat.length
        return next
      })
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      choose(flat[at])
    }
  }

  // Keeps the highlighted row in view when the arrow keys run past the edge of the list.
  useEffect(() => {
    const held = listRef.current?.querySelector<HTMLElement>('[data-at="true"]')
    held?.scrollIntoView({ block: 'nearest' })
  }, [at])

  let index = -1

  return (
    <div
      className={`popover glass na-labs${placement.down ? ' down' : ''}`}
      style={{
        ...(placement.down ? { top: placement.offset } : { bottom: placement.offset }),
        // The composer measured the gap this opens into. Without it the list overflows the window on a short one.
        maxHeight: placement.maxHeight
      }}
      role="dialog"
      aria-label="Search Labs"
      onKeyDown={onKey}
    >
      <label className="na-labs-search">
        <Search size={15} aria-hidden />
        <input
          ref={input}
          value={query}
          onChange={(event) => setQuery(event.target.value.slice(0, 120))}
          placeholder="Search Labs…"
          aria-label="Search Labs"
          aria-controls="na-labs-list"
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <div className="na-labs-list" id="na-labs-list" role="listbox" aria-label="Labs" ref={listRef}>
        {groups.map((group) => (
          <section key={group.label}>
            <h4>{group.label}</h4>
            {group.rows.map((row) => {
              index += 1
              const here = index === at
              const Icon = appIcon(row.icon)
              return (
                <button
                  key={row.id}
                  type="button"
                  role="option"
                  aria-selected={here}
                  aria-disabled={row.blocked !== null}
                  data-at={here ? 'true' : 'false'}
                  className={`na-labs-row${here ? ' at' : ''}${row.blocked !== null ? ' blocked' : ''}`}
                  onMouseEnter={() => setAt(index)}
                  onClick={() => choose(row)}
                >
                  <Icon size={16} aria-hidden />
                  <span className="na-labs-text">
                    <strong>{row.name}</strong>
                    {/* The reason it matched, so a surprising result explains itself rather than looking wrong. */}
                    <small>{row.blocked ?? row.because}</small>
                  </span>
                  {row.blocked !== null && <AlertCircle size={14} aria-hidden className="na-labs-warn" />}
                </button>
              )
            })}
          </section>
        ))}

        {!loading && rows.length === 0 && (
          /* Never a fabricated result. Orion is still there, which is the useful thing to say. */
          <p className="na-labs-empty">
            Nothing here matches that. Ask Orion instead — it answers plenty without opening anything.
          </p>
        )}
      </div>

      <footer className="na-labs-foot">
        <span>{openable.length} can open now</span>
        <span>↑↓ to move · Enter to open · Esc to close</span>
      </footer>
    </div>
  )
}
