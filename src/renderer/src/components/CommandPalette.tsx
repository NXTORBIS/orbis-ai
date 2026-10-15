import { useFlip } from '../lib/motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { searchCapabilities, unavailableBecause, type OrbisCapability, type Readiness } from '../../../shared/commandCenter'
import { FEATURE_LIST, featureById } from '../lib/features'
import type { FeatureId } from './Sidebar'
import './commandPalette.css'

/**
 * Everything Orbis can do, from one box.
 *
 * The window had eleven screens and nine of them had exactly one way in: a flat dropdown on the wordmark that you
 * had to already know was a menu. There was no keyboard route to any of them and no way to ask for one by name.
 * That is the whole of "I cannot find anything" -- the features were all there, and the only way to reach one was
 * to remember where it had been put.
 *
 * This is deliberately the *same* search the browser's Command Centre uses: `searchCapabilities` over the one
 * registry, scored the same way, refusing the same things for the same reasons. Two search boxes that rank
 * differently are two products. What differs is only what a hit does -- in the window a hit opens a screen; in the
 * panel it opens a view -- and that difference is read off the capability rather than decided here.
 *
 * A capability that cannot work right now is shown and said, never hidden: "Notes needs the browser running" is
 * something somebody can act on, and silence is not. It is not selectable, so Enter can never land on it.
 */

export interface CommandPaletteProps {
  open: boolean
  onClose(): void
  /** Opens one of the window's screens. */
  onFeature(id: FeatureId): void
  /** Opens the browser, for a capability that lives there. */
  onBrowser(): void
  /** What Orbis can do right now, so nothing is offered that cannot be done. */
  ready: Readiness
}

export default function CommandPalette({ open, onClose, onFeature, onBrowser, ready }: CommandPaletteProps): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setAt(0)
    // One frame, so the field exists before it is asked for the keyboard.
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  /**
   * What the box offers before anything is typed.
   *
   * The window's own screens, not the whole registry. An empty palette listing fifty-four things including eleven
   * chrome:// deep links is a wall; the eleven screens this window has are a menu, and they are what somebody
   * pressing Ctrl+K without a word in mind is almost always after.
   */
  const hits = useMemo(() => {
    if (query.trim() === '') {
      return FEATURE_LIST.map((one) => ({
        id: one.id,
        name: one.label,
        description: one.hint,
        feature: one.id as FeatureId,
        why: null as string | null
      }))
    }
    return searchCapabilities(query, ready, 10).map(({ capability }: { capability: OrbisCapability }) => ({
      id: capability.id,
      name: capability.name,
      description: capability.description,
      feature: capability.app ? (capability.app as FeatureId) : null,
      why: unavailableBecause(capability, ready)
    }))
  }, [query, ready])

  /** Only a hit that can actually be opened may be landed on. */
  const reachable = useMemo(() => hits.filter((one) => one.why === null), [hits])

  useEffect(() => {
    setAt((was) => (was >= reachable.length ? 0 : was))
  }, [reachable.length])

  // Rows slide to their new place as the list changes while typing, and new rows fade up.
  useFlip(listRef, hits.map((h) => h.id).join('|'))

  if (!open) return null

  const take = (hit: (typeof hits)[number]): void => {
    if (hit.why) return
    onClose()
    if (hit.feature) onFeature(hit.feature)
    else onBrowser()
  }

  const move = (delta: number): void => {
    if (!reachable.length) return
    const next = (at + delta + reachable.length) % reachable.length
    setAt(next)
    const row = listRef.current?.querySelector(`[data-at="${next}"]`)
    if (row instanceof HTMLElement) row.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div
      className="cp-back"
      role="presentation"
      onMouseDown={(event) => {
        // Only the backdrop itself: a drag that began inside the panel and ended out here is not a dismissal.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="cp" role="dialog" aria-modal="true" aria-label="Everything Orbis can do">
        <div className="cp-field">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            className="cp-input"
            type="text"
            value={query}
            placeholder="What do you need?"
            aria-label="Search everything Orbis can do"
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls="cp-list"
            aria-activedescendant={reachable[at] ? `cp-hit-${reachable[at].id}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value)
              setAt(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                move(1)
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                move(-1)
              } else if (event.key === 'Enter') {
                event.preventDefault()
                const hit = reachable[at]
                if (hit) take(hit)
              } else if (event.key === 'Escape') {
                // Taken here rather than let through: the shell's Escape would close the screen behind this one too.
                event.preventDefault()
                event.stopPropagation()
                onClose()
              }
            }}
          />
          <kbd className="cp-kbd">Esc</kbd>
        </div>

        <div className="cp-list" id="cp-list" role="listbox" ref={listRef} aria-label="Results">
          {hits.length === 0 && <p className="cp-none">Nothing matches “{query.trim()}”.</p>}
          {hits.map((hit) => {
            const index = reachable.indexOf(hit)
            const marked = index >= 0 && index === at
            return (
              <button
                key={hit.id}
                id={`cp-hit-${hit.id}`}
                type="button"
                role="option"
                aria-selected={marked}
                aria-disabled={hit.why !== null}
                data-at={index >= 0 ? index : undefined}
                data-flip={hit.id}
                className={`cp-hit${marked ? ' at' : ''}${hit.why ? ' off' : ''}`}
                onMouseEnter={() => index >= 0 && setAt(index)}
                onClick={() => take(hit)}
              >
                <span className="cp-hit-name">{hit.name}</span>
                {/* The reason, in the row, where the thing it is about is. A capability that cannot work says so. */}
                <span className="cp-hit-why">{hit.why ?? hit.description}</span>
              </button>
            )
          })}
        </div>

        <p className="cp-foot">
          <kbd>↑</kbd>
          <kbd>↓</kbd> to move · <kbd>Enter</kbd> to open
        </p>
      </div>
    </div>
  )
}

export { featureById }
