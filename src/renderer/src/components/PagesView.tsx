import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Equal, FlaskConical, Info, Ruler, Search, ShieldCheck, Star, WifiOff, Wrench, X } from 'lucide-react'
import type { NoticeKind } from '../App'
import type { PageCard, PageCategoryNode, PageComputeResult, PagePermission, PageSearchHit } from '../../../shared/types'
import { BuilderPanel, ComposePanel, DiagnosticsPanel, PackagePanel, STUDIO_TABS, type StudioTab } from './PageStudio'
import { LAB_PAGES } from './PageLabs'
import { ApplicationsPanel } from './PageApplications'
import { DescribePanel, GeneratedHistory, RunDocument } from './PageDescribe'
import type { PageDocument } from '../../../shared/pages/builder'
import {
  DataExplorerPage,
  FunctionPlotterPage,
  MeasurementLabPage,
  OptimiserPage,
  SimulationLabPage,
  StatisticsLabPage
} from './PageTools'

/**
 * Orbis Pages.
 *
 * A Page is a real destination with its own address, not a tab inside this panel -- so this screen is the library and the
 * frame, and the Page itself is what fills it. The three Pages Orbis ships are rendered here as their own components
 * because they are part of the build; every one of them does its work by calling `pagesCompute`, which is the only route
 * to the engines and is capability-checked on the way through.
 *
 * Nothing here computes anything. Every number on this screen came back from the main process, which is the whole point:
 * the same engine answers a Page, a workflow and Orion, so none of them can disagree about what two plus two is.
 */

type Screen = { kind: 'library' } | { kind: 'page'; page: PageCard } | { kind: 'studio'; tab: StudioTab }

const RISK_LABEL: Record<PagePermission['risk'], string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical'
}

/** The engine call every built-in Page makes. Returns the value, or throws with the message the service gave. */
async function compute(pageId: string, operation: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = (await window.api.pagesCompute({ pageId, operation, input })) as PageComputeResult
  if (!result || typeof result !== 'object') throw new Error('That calculation did not come back.')
  if (!('ok' in result)) throw new Error((result as { message?: string }).message ?? 'That calculation did not work.')
  if (!result.ok) {
    // The capability is named when that was the problem, so the message can say what to allow rather than just "no".
    throw new Error(result.capability ? `${result.message} (${result.capability})` : result.message)
  }
  return (result.value ?? {}) as Record<string, unknown>
}

export default function PagesView({
  onClose,
  onNotify
}: {
  onClose(): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>({ kind: 'library' })
  const [pages, setPages] = useState<PageCard[]>([])
  const [unavailable, setUnavailable] = useState<PageCard[]>([])
  const [recent, setRecent] = useState<PageCard[]>([])
  const [categories, setCategories] = useState<PageCategoryNode[]>([])
  const [problems, setProblems] = useState<{ slug: string; message: string }[]>([])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PageSearchHit[] | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const state = await window.api.pagesState()
    if ('error' in state) {
      onNotify(state.message ?? 'Pages could not be loaded', 'error')
      setLoading(false)
      return
    }
    setPages(state.pages)
    setUnavailable(state.unavailable)
    setRecent(state.recent)
    setCategories(state.categories)
    setProblems(state.problems)
    setLoading(false)
  }, [onNotify])

  useEffect(() => {
    void load()
  }, [load])

  // Searching goes to the register rather than filtering what is on screen, so the ranking is the real one.
  useEffect(() => {
    const text = query.trim()
    if (text === '') {
      setHits(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void window.api.pagesSearch(text, { limit: 20 }).then((result) => {
        if (cancelled) return
        setHits('error' in result ? [] : result.results)
      })
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const open = useCallback(
    async (page: PageCard) => {
      const result = await window.api.pagesOpen(page.url)
      if ('error' in result) {
        onNotify(result.message ?? 'That Page could not be opened', 'error')
        return
      }
      if (!result.found) {
        onNotify(result.message, 'error')
        return
      }
      setScreen({ kind: 'page', page: result.page })
      void load()
    },
    [load, onNotify]
  )

  const toggleFavourite = useCallback(
    async (page: PageCard) => {
      const result = await window.api.pagesFavourite(page.pageId, !page.favourite)
      if ('error' in result) {
        onNotify(result.message ?? 'That could not be saved', 'error')
        return
      }
      void load()
    },
    [load, onNotify]
  )

  const shown = useMemo(() => {
    if (hits !== null) return hits.map((one) => one.page)
    if (category === null) return pages
    return pages.filter((page) => page.categories.some((one) => one === category || one.startsWith(`${category}.`)))
  }, [hits, category, pages])

  if (screen.kind === 'studio') {
    const current = screen.tab
    return (
      <div className="view pages-view" role="region" aria-label="Page studio">
        <header className="view-head">
          <button type="button" className="icon-btn" aria-label="Back to Pages" onClick={() => setScreen({ kind: 'library' })}>
            <ArrowLeft size={16} />
          </button>
          <h2>Studio</h2>
          <div className="view-actions">
            <div className="page-chips" role="tablist" aria-label="Studio sections">
              {STUDIO_TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={current === id}
                  className={`page-chip${current === id ? ' on' : ''}`}
                  onClick={() => setScreen({ kind: 'studio', tab: id })}
                >
                  <Icon size={12} /> {label}
                </button>
              ))}
            </div>
            <button type="button" className="icon-btn" aria-label="Close Pages" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="pages-studio-body">
          {current === 'builder' && (
            // The preview runs under a real Page's capabilities: the builder has no identity of its own, and giving it
            // one would be a second thing that can reach the engines.
            <BuilderPanel pageId={pages[0]?.pageId ?? ''} onNotify={onNotify} />
          )}
          {current === 'describe' && (
            <DescribePanel
              onNotify={onNotify}
              onOpened={() => {
                setScreen({ kind: 'library' })
                void load()
              }}
            />
          )}
          {current === 'compose' && <ComposePanel onNotify={onNotify} />}
          {current === 'applications' && (
            <ApplicationsPanel
              pages={pages}
              onNotify={onNotify}
              onOpenPage={(pageId) => {
                const found = pages.find((one) => one.pageId === pageId)
                // A route can name a Page this profile does not have; the main process refuses that before it gets
                // here, so anything arriving is openable and a miss means the library has not reloaded yet.
                if (found === undefined) {
                  onNotify('That Page is not in this library yet.', 'error')
                  return
                }
                setScreen({ kind: 'page', page: found })
              }}
            />
          )}
          {current === 'package' && <PackagePanel pages={pages} onNotify={onNotify} />}
          {current === 'diagnostics' && <DiagnosticsPanel onNotify={onNotify} />}
        </div>
      </div>
    )
  }

  if (screen.kind === 'page') {
    return (
      <PageFrame
        page={screen.page}
        onBack={() => {
          setScreen({ kind: 'library' })
          void load()
        }}
        onClose={onClose}
        onNotify={onNotify}
      />
    )
  }

  return (
    <div className="view pages-view" role="region" aria-label="Orbis Pages">
      <header className="view-head">
        <h2>Pages</h2>
        <div className="view-actions">
          <label className="pages-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Pages"
              aria-label="Search Pages"
              spellCheck={false}
            />
            {query !== '' && (
              <button type="button" className="icon-btn" aria-label="Clear search" onClick={() => setQuery('')}>
                <X size={13} />
              </button>
            )}
          </label>
          <button
            type="button"
            className="queue-btn small ghost"
            onClick={() => setScreen({ kind: 'studio', tab: 'builder' })}
            title="Build a Page, open a package, or find out why one is misbehaving"
          >
            <Wrench size={13} /> Studio
          </button>
          <button type="button" className="icon-btn" aria-label="Close Pages" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="pages-body">
        <aside className="pages-side" aria-label="Subjects">
          <button
            type="button"
            className={`pages-cat${category === null ? ' active' : ''}`}
            onClick={() => setCategory(null)}
          >
            Everything <span className="pages-count">{pages.length}</span>
          </button>
          {categories.map((node) => (
            <CategoryRow key={node.path} node={node} active={category} onPick={setCategory} depth={0} />
          ))}
          {recent.length > 0 && (
            <>
              <h3 className="pages-side-head">Recently opened</h3>
              {recent.map((page) => (
                <button key={page.pageId} type="button" className="pages-recent" onClick={() => void open(page)}>
                  {page.title}
                </button>
              ))}
            </>
          )}
        </aside>

        <section className="pages-main" aria-label="Pages">
          {loading && <p className="pages-empty">Loading…</p>}

          {!loading && shown.length === 0 && (
            <p className="pages-empty">
              {hits !== null
                ? `Nothing matches “${query.trim()}”.`
                : 'No Pages here yet.'}
            </p>
          )}

          <div className="pages-grid">
            {shown.map((page) => {
              const hit = hits?.find((one) => one.page.pageId === page.pageId)
              return (
                <article key={page.pageId} className="pages-card">
                  <div className="pages-card-head">
                    <h3>
                      <button type="button" className="pages-card-title" onClick={() => void open(page)}>
                        {page.title}
                      </button>
                    </h3>
                    <button
                      type="button"
                      className={`icon-btn${page.favourite ? ' active' : ''}`}
                      aria-label={page.favourite ? `Remove ${page.title} from favourites` : `Add ${page.title} to favourites`}
                      aria-pressed={page.favourite}
                      onClick={() => void toggleFavourite(page)}
                    >
                      <Star size={14} />
                    </button>
                  </div>
                  <p className="pages-card-desc">{page.description}</p>
                  <div className="pages-card-meta">
                    <span className="pages-tag">{page.kind}</span>
                    {page.offline && (
                      <span className="pages-tag" title="Everything this Page does works with no network">
                        <WifiOff size={11} /> Offline
                      </span>
                    )}
                    <code className="pages-url">{page.url}</code>
                  </div>
                  {/* The signals that fired, so a ranking can be understood rather than trusted. */}
                  {hit && hit.matched.length > 0 && <p className="pages-why">Matched: {hit.matched.join(', ')}</p>}
                </article>
              )
            })}
          </div>

          {unavailable.length > 0 && (
            <section className="pages-unavailable" aria-label="Unavailable Pages">
              <h3>Not available</h3>
              {unavailable.map((page) => (
                <p key={page.pageId}>
                  <strong>{page.title}</strong> — {page.note || 'cannot open in this version of Orbis.'}
                </p>
              ))}
            </section>
          )}

          {/* A built-in Page whose manifest did not validate is shown rather than hidden: a Page that quietly failed to
              register would otherwise look like a Page that was never written. */}
          {problems.length > 0 && (
            <section className="pages-unavailable" aria-label="Pages that could not be registered">
              <h3>Could not be registered</h3>
              {problems.map((one) => (
                <p key={one.slug}>
                  <strong>{one.slug}</strong> — {one.message}
                </p>
              ))}
            </section>
          )}
        </section>
      </div>
    </div>
  )
}

function CategoryRow({
  node,
  active,
  onPick,
  depth
}: {
  node: PageCategoryNode
  active: string | null
  onPick(path: string | null): void
  depth: number
}): React.JSX.Element {
  return (
    <>
      <button
        type="button"
        className={`pages-cat${active === node.path ? ' active' : ''}`}
        style={{ paddingLeft: `${10 + depth * 12}px` }}
        onClick={() => onPick(active === node.path ? null : node.path)}
      >
        <span className="pages-cat-name">{node.name}</span>
        <span className="pages-count">{node.total}</span>
      </button>
      {node.children.map((child) => (
        <CategoryRow key={child.path} node={child} active={active} onPick={onPick} depth={depth + 1} />
      ))}
    </>
  )
}

// ---------------------------------------------------------------- the frame a Page sits in

function PageFrame({
  page,
  onBack,
  onClose,
  onNotify
}: {
  page: PageCard
  onBack(): void
  onClose(): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [permissions, setPermissions] = useState<PagePermission[]>([])
  const [showing, setShowing] = useState(false)

  useEffect(() => {
    void window.api.pagesPermissions(page.pageId).then((result) => {
      if ('error' in result) return
      setPermissions(result.permissions)
    })
  }, [page.pageId])

  return (
    <div className="view pages-view" role="region" aria-label={page.title}>
      <header className="view-head">
        <button type="button" className="icon-btn" aria-label="Back to Pages" onClick={onBack}>
          <ArrowLeft size={16} />
        </button>
        <h2>{page.title}</h2>
        <div className="view-actions">
          <code className="pages-url">{page.url}</code>
          <button
            type="button"
            className={`queue-btn${showing ? ' primary' : ''}`}
            aria-expanded={showing}
            onClick={() => setShowing((one) => !one)}
          >
            <ShieldCheck size={14} /> What it can do
          </button>
          <button type="button" className="icon-btn" aria-label="Close Pages" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </header>

      {showing && (
        <section className="pages-permissions" aria-label="What this Page can do">
          {permissions.length === 0 && <p>This Page asks for nothing.</p>}
          {permissions.map((one) => (
            <p key={one.capabilityId} className={`pages-perm ${one.outcome}`}>
              {one.outcome === 'allow' ? <Check size={13} /> : <Info size={13} />}
              <strong>{one.name}</strong>
              <span className="pages-tag">{RISK_LABEL[one.risk]}</span>
              {one.scope !== '' && <code>{one.scope}</code>}
              <span className="pages-perm-why">{one.message}</span>
            </p>
          ))}
          {page.limitations.length > 0 && (
            <>
              <h4>What it cannot do</h4>
              {page.limitations.map((one) => (
                <p key={one} className="pages-limitation">
                  {one}
                </p>
              ))}
            </>
          )}
        </section>
      )}

      <div className="pages-page">
        {page.slug === 'unit-converter' && <UnitConverterPage pageId={page.pageId} onNotify={onNotify} />}
        {page.slug === 'equation-solver' && <EquationSolverPage pageId={page.pageId} onNotify={onNotify} />}
        {page.slug === 'calculus-lab' && <CalculusLabPage pageId={page.pageId} onNotify={onNotify} />}
        {page.slug === 'function-plotter' && <FunctionPlotterPage pageId={page.pageId} onNotify={onNotify} />}
        {page.slug === 'statistics-lab' && <StatisticsLabPage pageId={page.pageId} onNotify={onNotify} />}
        {page.slug === 'data-explorer' && <DataExplorerPage pageId={page.pageId} onNotify={onNotify} />}
        {page.slug === 'measurement-lab' && <MeasurementLabPage pageId={page.pageId} onNotify={onNotify} />}
        {page.slug === 'optimiser' && <OptimiserPage pageId={page.pageId} onNotify={onNotify} />}
        {page.slug === 'simulation-lab' && <SimulationLabPage pageId={page.pageId} onNotify={onNotify} />}
        {/* The thirteen newer Pages, looked up by slug rather than compared one at a time -- a chain of thirteen more
            comparisons would be the same code with more places to forget one. */}
        {LabPageFor(page.slug, page.pageId, onNotify)}
        {/* A Page Orbis built. It has no component of its own -- it is a document, rendered by the same runtime the
            builder's preview uses, running through the same `pages:compute` channel as every Page above. */}
        {page.categories.includes('generated') && <GeneratedPage pageId={page.pageId} onNotify={onNotify} />}
      </div>
    </div>
  )
}

/**
 * A Page Orbis built, opened.
 *
 * The document is fetched rather than carried in the card, because a card is what the library shows for every Page
 * and a document is only meaningful for this kind. Asking for one is scoped to the profile that built it.
 */
function GeneratedPage({
  pageId,
  onNotify
}: {
  pageId: string
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [document, setDocument] = useState<PageDocument | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    void window.api.pagesGenerateDocument(pageId).then((result) => {
      if (cancelled) return
      if ('error' in result) {
        setMessage(result.message ?? 'That Page has nothing to open.')
        return
      }
      setDocument(result.document as PageDocument)
    })
    return () => {
      cancelled = true
    }
  }, [pageId])

  if (message !== '') return <p className="page-note">{message}</p>
  if (document === null) return <p className="page-note">Opening{'…'}</p>
  return (
    <>
      <RunDocument pageId={pageId} document={document} onNotify={onNotify} />
      <GeneratedHistory pageId={pageId} onNotify={onNotify} onChanged={() => setDocument(null)} />
    </>
  )
}

/**
 * The built-in Page for a slug, where one of the newer labs owns it.
 *
 * Read with `hasOwnProperty` rather than by indexing: a Page whose slug is `constructor` would otherwise resolve to a
 * function and be rendered as a component. A slug comes from a manifest, so it is somebody else's text.
 */
function LabPageFor(slug: string, pageId: string, onNotify: (m: string, k?: NoticeKind) => void): React.JSX.Element | null {
  if (!Object.prototype.hasOwnProperty.call(LAB_PAGES, slug)) return null
  const Page = LAB_PAGES[slug]
  return <Page pageId={pageId} onNotify={onNotify} />
}

// ---------------------------------------------------------------- Unit Converter

function UnitConverterPage({ pageId, onNotify }: { pageId: string; onNotify(m: string, k?: NoticeKind): void }): React.JSX.Element {
  const [value, setValue] = useState('36')
  const [from, setFrom] = useState('km/h')
  const [to, setTo] = useState('m/s')
  const [answer, setAnswer] = useState<{ display: string; dimension: string; exact: boolean } | null>(null)
  const [problem, setProblem] = useState('')
  const [options, setOptions] = useState<{ id: string; symbol: string; name: string }[]>([])

  const run = useCallback(async () => {
    const amount = Number(value)
    if (!Number.isFinite(amount)) {
      setProblem('That is not a number.')
      setAnswer(null)
      return
    }
    try {
      const result = await compute(pageId, 'units.convert', { value: amount, from, to })
      if (result.ok !== true) {
        // The engine's own words. A dimension mismatch names both sides, which is the useful part.
        setProblem(String(result.message ?? 'That conversion is not possible.'))
        setAnswer(null)
        return
      }
      setProblem('')
      setAnswer({
        display: String(result.display),
        dimension: String(result.dimension),
        exact: result.exact === true
      })
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.')
      setAnswer(null)
    }
  }, [pageId, value, from, to])

  useEffect(() => {
    void run()
  }, [run])

  // Only the units that could actually work: offering a pressure for a length is offering an error.
  useEffect(() => {
    let cancelled = false
    void compute(pageId, 'units.compatible', { unit: from })
      .then((result) => {
        if (cancelled || result.ok !== true) return
        setOptions((result.units as { id: string; symbol: string; name: string }[]).slice(0, 60))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [pageId, from])

  return (
    <section className="page-pane" aria-label="Unit Converter">
      <div className="page-row">
        <label className="page-field">
          <span>Amount</span>
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" spellCheck={false} />
        </label>
        <label className="page-field">
          <span>From</span>
          <input value={from} onChange={(e) => setFrom(e.target.value)} spellCheck={false} placeholder="km/h" />
        </label>
        <ArrowRight size={16} className="page-arrow" aria-hidden />
        <label className="page-field">
          <span>To</span>
          <input value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} placeholder="m/s" />
        </label>
      </div>

      {answer && (
        <output className="page-answer">
          <Ruler size={16} aria-hidden />
          <strong>{answer.display}</strong>
          <span className="pages-tag">{answer.dimension}</span>
          {/* Said only when both units are exact by definition, because "exact" is a claim. */}
          {answer.exact && <span className="pages-tag">exact by definition</span>}
        </output>
      )}
      {problem !== '' && <p className="page-problem">{problem}</p>}

      {options.length > 0 && (
        <div className="page-chips" aria-label="Units this could be converted to">
          {options.map((one) => (
            <button key={one.id} type="button" className="page-chip" onClick={() => setTo(one.symbol || one.id)} title={one.name}>
              {one.symbol || one.id}
            </button>
          ))}
        </div>
      )}

      <p className="page-note">
        Currency is not here. An exchange rate is a fact about today that has to be fetched, and this Page asks for no
        network — so inventing one is the one thing it will not do.
      </p>
      <button
        type="button"
        className="queue-btn small"
        onClick={() =>
          void window.api
            .pagesProjectSave(pageId, null, `${value} ${from} to ${to}`, { value, from, to })
            .then((result) => onNotify('saved' in result && result.saved ? 'Saved' : 'Could not save', 'saved' in result && result.saved ? 'info' : 'error'))
        }
      >
        Save this conversion
      </button>
    </section>
  )
}

// ---------------------------------------------------------------- Equation Solver

function EquationSolverPage({ pageId, onNotify }: { pageId: string; onNotify(m: string, k?: NoticeKind): void }): React.JSX.Element {
  const [text, setText] = useState('x^2 + 3x + 2 = 0')
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [steps, setSteps] = useState<{ label: string; detail: string }[]>([])
  const [problem, setProblem] = useState('')

  const run = useCallback(async () => {
    try {
      const answer = await compute(pageId, 'solver.solve', { equation: text })
      setProblem('')
      setResult(answer.result as Record<string, unknown>)
      setSteps((answer.steps as { label: string; detail: string }[]) ?? [])
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.')
      setResult(null)
      setSteps([])
    }
  }, [pageId, text])

  const solutions = (result?.solutions ?? []) as { value: number; residual: number; confidence: string; multiplicity?: number }[]
  const complex = (result?.complex ?? []) as { real: number; imaginary: number }[]
  const notes = (result?.notes ?? []) as string[]

  return (
    <section className="page-pane" aria-label="Equation Solver">
      <label className="page-field wide">
        <span>Equation</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void run()}
          spellCheck={false}
          placeholder="x^2 + 3x + 2 = 0"
        />
      </label>
      <button type="button" className="queue-btn primary" onClick={() => void run()}>
        <Equal size={14} /> Solve
      </button>

      {problem !== '' && <p className="page-problem">{problem}</p>}

      {result && (
        <>
          <p className="page-answer-line">
            <strong>{String(result.message)}</strong>
            <span className="pages-tag">{String(result.kind)}</span>
            <span className="pages-tag">{String(result.method)}</span>
          </p>

          {/* The residual is shown with every root, not tucked away: it is the evidence the answer is right. */}
          {solutions.length > 0 && (
            <table className="page-table">
              <thead>
                <tr>
                  <th>{String(result.variable)}</th>
                  <th>Checked</th>
                  <th>Off by</th>
                </tr>
              </thead>
              <tbody>
                {solutions.map((one, i) => (
                  <tr key={i}>
                    <td>
                      {Number(one.value.toPrecision(12))}
                      {one.multiplicity ? ` (twice)` : ''}
                    </td>
                    <td>{one.confidence}</td>
                    <td>{one.residual === 0 ? 'exactly' : one.residual.toExponential(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {complex.length > 0 && (
            <p className="page-note">
              No real answer. The two complex roots are{' '}
              {complex
                .map((one) => `${Number(one.real.toPrecision(8))}${one.imaginary >= 0 ? ' + ' : ' − '}${Math.abs(Number(one.imaginary.toPrecision(8)))}i`)
                .join(' and ')}
              .
            </p>
          )}

          {notes.map((one) => (
            <p key={one} className="page-note">
              {one}
            </p>
          ))}

          {steps.length > 0 && (
            <details className="page-steps">
              <summary>How it got there</summary>
              {steps.map((one, i) => (
                <p key={i}>
                  <strong>{one.label}</strong> — {one.detail}
                </p>
              ))}
            </details>
          )}
        </>
      )}

      <button
        type="button"
        className="queue-btn small"
        onClick={() =>
          void window.api
            .pagesProjectSave(pageId, null, text, { equation: text })
            .then((r) => onNotify('saved' in r && r.saved ? 'Saved' : 'Could not save', 'saved' in r && r.saved ? 'info' : 'error'))
        }
      >
        Save this equation
      </button>
    </section>
  )
}

// ---------------------------------------------------------------- Calculus Laboratory

function CalculusLabPage({ pageId, onNotify }: { pageId: string; onNotify(m: string, k?: NoticeKind): void }): React.JSX.Element {
  const [text, setText] = useState('sin(x^2)')
  const [variable, setVariable] = useState('x')
  const [at, setAt] = useState('1')
  const [derivative, setDerivative] = useState('')
  const [simplified, setSimplified] = useState('')
  const [value, setValue] = useState<string>('')
  const [problem, setProblem] = useState('')

  const run = useCallback(async () => {
    setProblem('')
    try {
      const tidy = await compute(pageId, 'expression.simplify', { text })
      setSimplified(tidy.ok === true ? String(tidy.text) : '')

      const d = await compute(pageId, 'expression.differentiate', { text, variable })
      if (d.ok !== true) {
        // A function with no derivative rule is refused by name rather than approximated.
        setDerivative('')
        setProblem(String(d.message))
      } else {
        setDerivative(String(d.text))
      }

      const point = Number(at)
      if (Number.isFinite(point)) {
        const evaluated = await compute(pageId, 'expression.evaluate', { text, scope: { [variable]: point } })
        setValue(evaluated.ok === true ? String(Number(Number(evaluated.value).toPrecision(10))) : String(evaluated.message))
      } else {
        setValue('')
      }
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.')
      setDerivative('')
      setSimplified('')
    }
  }, [pageId, text, variable, at])

  useEffect(() => {
    void run()
  }, [run])

  return (
    <section className="page-pane" aria-label="Calculus Laboratory">
      <div className="page-row">
        <label className="page-field wide">
          <span>Expression</span>
          <input value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder="sin(x^2)" />
        </label>
        <label className="page-field narrow">
          <span>In terms of</span>
          <input value={variable} onChange={(e) => setVariable(e.target.value)} spellCheck={false} />
        </label>
        <label className="page-field narrow">
          <span>At</span>
          <input value={at} onChange={(e) => setAt(e.target.value)} inputMode="decimal" spellCheck={false} />
        </label>
      </div>

      {simplified !== '' && (
        <output className="page-answer">
          <FlaskConical size={16} aria-hidden />
          <span className="page-label">Simplified</span>
          <code>{simplified}</code>
        </output>
      )}
      {derivative !== '' && (
        <output className="page-answer">
          <span className="page-label">
            d/d{variable}
          </span>
          <code>{derivative}</code>
        </output>
      )}
      {value !== '' && (
        <output className="page-answer">
          <span className="page-label">
            Value at {variable} = {at}
          </span>
          <code>{value}</code>
        </output>
      )}
      {problem !== '' && <p className="page-problem">{problem}</p>}

      <p className="page-note">
        abs, sign, floor, ceil and round have no derivative everywhere, so this Page refuses them by name rather than
        returning one that is wrong at the interesting point.
      </p>
      <button
        type="button"
        className="queue-btn small"
        onClick={() =>
          void window.api
            .pagesProjectSave(pageId, null, text, { text, variable, at })
            .then((r) => onNotify('saved' in r && r.saved ? 'Saved' : 'Could not save', 'saved' in r && r.saved ? 'info' : 'error'))
        }
      >
        Save this expression
      </button>
    </section>
  )
}
