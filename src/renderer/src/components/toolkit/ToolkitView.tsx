import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Star, Wrench } from 'lucide-react'
import { useSurface } from '../../lib/surfaces'
import { SearchBox, ViewHeader } from '../../ui'
import { toolkitSurface } from './toolkitSurface'
import '@jarvis/jarvis.css'
import './toolkit.css'

/**
 * The Toolkit.
 *
 * Every tool in it is a screen of its own that does its own calculation or conversion, here exactly as it was
 * written. This is only the shelf: search, categories, favourites, and the room a tool opens in. Nothing on it is a
 * description of a tool that is not really there.
 *
 * The tools' registry is loaded when the screen opens rather than with the window, because it names two thousand
 * tools and the window is open all day.
 */

interface ToolEntry {
  id: string
  label: string
  desc?: string
  categoryId: string
  isNew?: boolean
  component: React.ComponentType<Record<string, unknown>>
}
interface Category {
  id: string
  label: string
  tools: Omit<ToolEntry, 'categoryId'>[]
}
interface Registry {
  TOOLKIT_CATEGORIES: Category[]
  ALL_TOOLS: ToolEntry[]
}

const FAVOURITES = 'orbis.toolkit.favourites'
const RECENT = 'orbis.toolkit.recent'

const readList = (key: string): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}
const writeList = (key: string, list: string[]): void => {
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    // Not available in a private window; the shelf still works.
  }
}

const PAGE = 48

export default function ToolkitView({ onClose, opening }: { onClose(): void; opening?: string }): React.JSX.Element {
  const [registry, setRegistry] = useState<Registry | null>(null)
  const [failed, setFailed] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [openId, setOpenId] = useState<string | null>(opening ?? null)
  const [limit, setLimit] = useState(PAGE)
  const [favourites, setFavourites] = useState<string[]>(() => readList(FAVOURITES))
  const [recent, setRecent] = useState<string[]>(() => readList(RECENT))

  useEffect(() => {
    let live = true
    void import('@jarvis/components/toolkit/registry').then(
      (mod: unknown) => {
        if (live) setRegistry(mod as Registry)
      },
      (error: unknown) => {
        if (live) setFailed(error instanceof Error ? error.message : String(error))
      }
    )
    return () => {
      live = false
    }
  }, [])

  /*
   * A checking hook, off unless asked for: with `orbis.toolkit.probe` set in local storage, the screen exposes the
   * list of tools and a way to open one, so every tool can be opened and read by a script. It changes nothing for
   * anybody who has not set that.
   */
  useEffect(() => {
    if (!registry) return
    let on = false
    try {
      on = localStorage.getItem('orbis.toolkit.probe') === '1'
    } catch {
      on = false
    }
    if (!on) return
    const hook = {
      tools: registry.ALL_TOOLS.map((t) => ({ id: t.id, label: t.label, desc: t.desc ?? '', category: t.categoryId })),
      categories: registry.TOOLKIT_CATEGORIES.map((c) => ({ id: c.id, label: c.label, count: c.tools.length })),
      open: (id: string | null) => setOpenId(id)
    }
    ;(window as unknown as { __toolkitProbe?: unknown }).__toolkitProbe = hook
    return () => {
      delete (window as unknown as { __toolkitProbe?: unknown }).__toolkitProbe
    }
  }, [registry])

  const byId = useMemo(() => new Map((registry?.ALL_TOOLS ?? []).map((t) => [t.id, t])), [registry])
  const open = openId ? byId.get(openId) : undefined

  const visible = useMemo(() => {
    const all = registry?.ALL_TOOLS ?? []
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return all.filter((t) => {
      if (category === 'favourites' && !favourites.includes(t.id)) return false
      if (category !== 'all' && category !== 'favourites' && t.categoryId !== category) return false
      if (words.length === 0) return true
      const haystack = `${t.label} ${t.desc ?? ''} ${t.id}`.toLowerCase()
      return words.every((w) => haystack.includes(w))
    })
  }, [registry, query, category, favourites])

  useEffect(() => setLimit(PAGE), [query, category])

  const choose = useCallback((id: string) => {
    setOpenId(id)
    setRecent((current) => {
      const next = [id, ...current.filter((one) => one !== id)].slice(0, 12)
      writeList(RECENT, next)
      return next
    })
  }, [])

  const toggleFavourite = (id: string): void =>
    setFavourites((current) => {
      const next = current.includes(id) ? current.filter((one) => one !== id) : [...current, id]
      writeList(FAVOURITES, next)
      return next
    })

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (openId) setOpenId(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openId, onClose])

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of registry?.ALL_TOOLS ?? []) map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + 1)
    return map
  }, [registry])

  const recents = recent.map((id) => byId.get(id)).filter((t): t is ToolEntry => Boolean(t))

  /*
   * The shelf, as something Orbis can work rather than click at.
   *
   * Only the shelf: which tool is open, what is being searched for and which category is showing. A tool's own
   * screen says what can be done inside it, and the ones that do are listed in `CONTROLLABLE_TOOLS` so a route to
   * one can be worked out before it is open -- which is how "open the Algorithm Visualizer and set its speed"
   * reaches a control two levels down without anybody naming the Toolkit.
   */
  useSurface(
    toolkitSurface({
      tools: registry?.ALL_TOOLS ?? [],
      categories: registry?.TOOLKIT_CATEGORIES ?? [],
      loaded: () => registry !== null,
      failed: () => failed,
      open: () => openId,
      // The same handler a card's click calls, so a tool Orbis opens is in the recently used row too.
      openTool: (id) => (id === null ? setOpenId(null) : choose(id)),
      search: () => query,
      setSearch: setQuery,
      category: () => category,
      setCategory,
      favourites: () => favourites,
      showing: () => visible.length,
      close: onClose
    })
  )

  return (
    <div className="tk-view" role="region" aria-label="Toolkit">
      <ViewHeader
        className="tk-head"
        lead={
          <button type="button" className="tk-back" onClick={openId ? () => setOpenId(null) : onClose} aria-label={openId ? 'Back to the toolkit' : 'Close the toolkit'}>
            <ArrowLeft size={16} />
            <span>{openId ? 'Toolkit' : 'Back'}</span>
          </button>
        }
        icon={<Wrench size={18} aria-hidden />}
        title={open ? open.label : 'Toolkit'}
        note={open ? undefined : registry ? `${registry.ALL_TOOLS.length} tools` : 'Opening the toolkit…'}
        /* Inside a tool there is nothing to search: the row holds the one thing you can do to it instead. */
        search={open ? undefined : <SearchBox value={query} onChange={setQuery} label="Search tools" autoFocus clearable />}
        actions={
          open ? (
            <button
              type="button"
              className={`tk-star${favourites.includes(open.id) ? ' on' : ''}`}
              onClick={() => toggleFavourite(open.id)}
              aria-pressed={favourites.includes(open.id)}
              aria-label={favourites.includes(open.id) ? 'Remove from favourites' : 'Add to favourites'}
            >
              <Star size={16} />
            </button>
          ) : undefined
        }
      />

      {failed && <p className="tk-note" role="alert">The toolkit could not be loaded: {failed}</p>}
      {!registry && !failed && <p className="tk-note" role="status">Opening the toolkit…</p>}

      {registry && open && (
        <div className="tk-stage">
          {open.desc && <p className="tkv-desc">{open.desc}</p>}
          <div className="jarvis-scope dark tk-tool">
            <Suspense fallback={<p className="tk-note" role="status">Loading {open.label}…</p>}>
              <ToolHost key={open.id} tool={open} />
            </Suspense>
          </div>
        </div>
      )}

      {registry && !open && (
        <div className="tk-body">
          <nav className="tk-cats" aria-label="Categories">
            <button type="button" className={category === 'all' ? 'on' : ''} onClick={() => setCategory('all')}>
              <span>All tools</span>
              <small>{registry.ALL_TOOLS.length}</small>
            </button>
            <button type="button" className={category === 'favourites' ? 'on' : ''} onClick={() => setCategory('favourites')}>
              <span>Favourites</span>
              <small>{favourites.length}</small>
            </button>
            {registry.TOOLKIT_CATEGORIES.map((c) => (
              <button key={c.id} type="button" className={category === c.id ? 'on' : ''} onClick={() => setCategory(c.id)}>
                <span>{c.label}</span>
                <small>{counts.get(c.id) ?? 0}</small>
              </button>
            ))}
          </nav>
          <section className="tk-shelf">
            {recents.length > 0 && category === 'all' && !query && (
              <div className="tk-recent">
                <h3>Recently used</h3>
                <div>
                  {recents.slice(0, 6).map((t) => (
                    <button key={t.id} type="button" onClick={() => choose(t.id)}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="tk-count" role="status">
              {visible.length} {visible.length === 1 ? 'tool' : 'tools'}
            </p>
            <ul className="tk-grid">
              {visible.slice(0, limit).map((t) => (
                <li key={t.id}>
                  <button type="button" className="tkv-card" onClick={() => choose(t.id)}>
                    <strong>{t.label}</strong>
                    {t.desc && <span>{t.desc}</span>}
                  </button>
                  <button
                    type="button"
                    className={`tkv-card-star${favourites.includes(t.id) ? ' on' : ''}`}
                    onClick={() => toggleFavourite(t.id)}
                    aria-pressed={favourites.includes(t.id)}
                    aria-label={`${favourites.includes(t.id) ? 'Remove' : 'Add'} ${t.label} ${favourites.includes(t.id) ? 'from' : 'to'} favourites`}
                  >
                    <Star size={14} />
                  </button>
                </li>
              ))}
            </ul>
            {visible.length > limit && (
              <button type="button" className="tk-more" onClick={() => setLimit((n) => n + PAGE * 2)}>
                Show more ({visible.length - limit} left)
              </button>
            )}
            {visible.length === 0 && <p className="tk-note">Nothing matches that. Try fewer words.</p>}
          </section>
        </div>
      )}
    </div>
  )
}

/** Renders one tool. A tool that throws takes down only itself, and says so. */
function ToolHost({ tool }: { tool: ToolEntry }): React.JSX.Element {
  const Component = tool.component
  return (
    <ToolBoundary label={tool.label}>
      <Component />
    </ToolBoundary>
  )
}

import { Component as ReactComponent, type ErrorInfo, type ReactNode } from 'react'
class ToolBoundary extends ReactComponent<{ label: string; children: ReactNode }, { error: string }> {
  state = { error: '' }
  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // The message is shown; nothing else leaves the screen.
  }
  render(): ReactNode {
    if (this.state.error) return <p className="tk-note" role="alert">{this.props.label} could not run: {this.state.error}</p>
    return this.props.children
  }
}

export const _unused = lazy
