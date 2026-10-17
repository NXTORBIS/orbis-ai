import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, Check, GripVertical, Home, Plus, Trash2 } from 'lucide-react'
import type { NoticeKind } from '../lib/notices'
import type { PageApplicationSummary, PageCard } from '../../../shared/types'

/**
 * Applications: several Pages behaving as one thing, with routes and a navigation.
 *
 * A Page stays a Page. An application refers to Pages by id and never copies them, so the same Page can sit in two
 * applications and still open on its own — which is why this screen builds a list of references rather than an
 * editor for the Pages themselves.
 *
 * ## Nothing here decides whether an application is sound
 *
 * Every problem shown on this screen came back from `checkApplication` in the main process, already split into the
 * ones that stop an application working and the ones that merely look unintended. This screen renders that split
 * and does not compute it, for the same reason nothing else in Pages computes in the renderer: the answer a person
 * sees has to be the answer the thing that enforces it gave.
 *
 * ## Why the save button can be refused
 *
 * Saving sends the whole application and the main process rebuilds it through its own constructors. A route with
 * two Pages on it, or a default route nobody answers, comes back refused with the reason — so the button is not a
 * promise that the edit was valid, and the message it shows is the real one rather than a guess made here.
 */

/** A row being edited. `route` is text while somebody is typing, and is only parsed when it is saved. */
interface DraftPage {
  pageId: string
  route: string
  label: string
}

interface Draft {
  applicationId: string
  slug: string
  title: string
  description: string
  pages: DraftPage[]
  defaultRoute: string
}

/** A new application id, from the browser's own randomness. The main process validates the shape. */
function newApplicationId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `app_${Array.from(bytes, (one) => one.toString(16).padStart(2, '0')).join('').slice(0, 32)}`
}

const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)

/** The JSON the main process expects, from a draft. Routes are sent as typed; it parses and refuses them. */
function draftToJson(draft: Draft): Record<string, unknown> {
  return {
    schema: 1,
    applicationId: draft.applicationId,
    slug: draft.slug,
    title: draft.title,
    description: draft.description,
    version: '1.0.0',
    // The owning profile is overwritten on the other side with whoever is asking, so there is nothing to send.
    ownerProfile: '',
    defaultRoute: draft.defaultRoute,
    groups: [],
    pages: draft.pages.map((one, index) => ({
      pageId: one.pageId,
      route: one.route,
      label: one.label,
      group: null,
      order: index,
      visibility: 'visible',
      configuration: {}
    })),
    contracts: [],
    adapters: [],
    sharedValues: [],
    bindings: [],
    flows: []
  }
}

export function ApplicationsPanel({
  pages,
  onOpenPage,
  onNotify
}: {
  pages: PageCard[]
  onOpenPage(pageId: string): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [applications, setApplications] = useState<PageApplicationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await window.api.pagesApplications()
    setLoading(false)
    if (!result || !('applications' in result)) {
      onNotify((result as { message?: string })?.message ?? 'Applications could not be listed.', 'error')
      return
    }
    setApplications(result.applications)
  }, [onNotify])

  useEffect(() => {
    void load()
  }, [load])

  const byId = useMemo(() => new Map(pages.map((one) => [one.pageId, one])), [pages])

  const startNew = (): void => {
    setDraft({
      applicationId: newApplicationId(),
      slug: '',
      title: '',
      description: '',
      pages: [],
      defaultRoute: '/'
    })
  }

  const startEdit = async (summary: PageApplicationSummary): Promise<void> => {
    const result = await window.api.pagesApplication(summary.applicationId)
    if (!result || !('application' in result) || result.application === null) {
      onNotify('That application could not be opened for editing.', 'error')
      return
    }
    const stored = result.application as {
      applicationId: string
      slug: string
      title: string
      description: string
      defaultRoute: string
      pages: { pageId: string; route: string; label: string }[]
    }
    setDraft({
      applicationId: stored.applicationId,
      slug: stored.slug,
      title: stored.title,
      description: stored.description,
      pages: stored.pages.map((one) => ({ pageId: one.pageId, route: one.route, label: one.label })),
      defaultRoute: stored.defaultRoute
    })
  }

  const save = async (): Promise<void> => {
    if (draft === null) return
    setSaving(true)
    const result = await window.api.pagesApplicationSave(draftToJson({ ...draft, slug: draft.slug || slugify(draft.title) }))
    setSaving(false)
    if (!result || !('saved' in result) || !result.saved) {
      // The real reason, from the side that refused it. Never a guess made here.
      onNotify((result as { message?: string })?.message ?? 'That application could not be saved.', 'error')
      return
    }
    setApplications(result.applications)
    setDraft(null)
    onNotify('Application saved.', 'info')
  }

  const remove = async (summary: PageApplicationSummary): Promise<void> => {
    const result = await window.api.pagesApplicationDelete(summary.applicationId)
    if (!result || !('deleted' in result)) {
      onNotify('That application could not be removed.', 'error')
      return
    }
    setApplications(result.applications)
    onNotify(result.deleted ? `"${summary.title}" was removed.` : 'There was nothing to remove.', 'info')
  }

  const openRoute = async (applicationId: string, route: string): Promise<void> => {
    const result = await window.api.pagesApplicationRoute(applicationId, route)
    if (!result || !('ok' in result) || !result.ok) {
      onNotify((result as { message?: string })?.message ?? 'That route did not open.', 'error')
      return
    }
    onOpenPage(result.pageId)
  }

  // ---------------------------------------------------------------- editing

  if (draft !== null) {
    const used = new Set(draft.pages.map((one) => one.pageId))
    const available = pages.filter((one) => !used.has(one.pageId))
    return (
      <div className="page-pane" role="region" aria-label="Edit application">
        <div className="page-row">
          <button type="button" className="icon-btn" aria-label="Back to applications" onClick={() => setDraft(null)}>
            <ArrowLeft size={16} />
          </button>
          <strong>{draft.title === '' ? 'New application' : draft.title}</strong>
        </div>

        <label className="page-field">
          <span className="page-label">Name</span>
          <input
            type="text"
            value={draft.title}
            maxLength={120}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            placeholder="Research"
          />
        </label>

        <label className="page-field">
          <span className="page-label">Address</span>
          <input
            type="text"
            value={draft.slug}
            maxLength={64}
            onChange={(event) => setDraft({ ...draft, slug: slugify(event.target.value) })}
            placeholder={slugify(draft.title) || 'research'}
          />
          <span className="page-note">orbis://apps/{draft.slug || slugify(draft.title) || 'research'}</span>
        </label>

        <label className="page-field">
          <span className="page-label">What it is for</span>
          <input
            type="text"
            value={draft.description}
            maxLength={600}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </label>

        <div className="page-block">
          <span className="page-label">Pages in it</span>
          {draft.pages.length === 0 && (
            <p className="page-note">
              Nothing yet. An application with no Pages cannot be opened, so add at least one below.
            </p>
          )}
          {draft.pages.map((one, index) => (
            <div className="page-row" key={one.pageId}>
              <GripVertical size={14} aria-hidden />
              <span className="page-label">{byId.get(one.pageId)?.title ?? one.pageId}</span>
              <input
                type="text"
                aria-label={`Route for ${one.label}`}
                value={one.route}
                maxLength={120}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    pages: draft.pages.map((row, i) => (i === index ? { ...row, route: event.target.value } : row))
                  })
                }
                placeholder="/data"
              />
              <input
                type="text"
                aria-label={`Label for ${one.label}`}
                value={one.label}
                maxLength={120}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    pages: draft.pages.map((row, i) => (i === index ? { ...row, label: event.target.value } : row))
                  })
                }
                placeholder="Data"
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={`Open at ${one.route}`}
                title="Open this route"
                onClick={() => setDraft({ ...draft, defaultRoute: one.route })}
              >
                <Home size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${one.label}`}
                onClick={() =>
                  setDraft({ ...draft, pages: draft.pages.filter((_, i) => i !== index) })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <p className="page-note">
            The house icon sets which route the application opens at. It is currently{' '}
            <code>{draft.defaultRoute}</code>.
          </p>
        </div>

        {available.length > 0 && (
          <div className="page-block">
            <span className="page-label">Add a Page</span>
            <div className="page-chips">
              {available.slice(0, 40).map((one) => (
                <button
                  key={one.pageId}
                  type="button"
                  className="page-chip"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      pages: [
                        ...draft.pages,
                        {
                          pageId: one.pageId,
                          // The first Page added answers the root, so a new application opens at something.
                          route: draft.pages.length === 0 ? '/' : `/${one.slug}`,
                          label: one.title
                        }
                      ]
                    })
                  }
                >
                  <Plus size={12} /> {one.title}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="page-row">
          <button type="button" className="page-chip on" disabled={saving} onClick={() => void save()}>
            <Check size={12} /> {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="page-chip" onClick={() => setDraft(null)}>
            Cancel
          </button>
        </div>
        <p className="page-note">
          Saving checks the whole application on the other side. A route two Pages answer, or an opening route
          nobody answers, comes back refused with the reason.
        </p>
      </div>
    )
  }

  // ---------------------------------------------------------------- the list

  return (
    <div className="page-pane" role="region" aria-label="Applications">
      <div className="page-row">
        <strong>Applications</strong>
        <button type="button" className="page-chip" onClick={startNew}>
          <Plus size={12} /> New
        </button>
      </div>

      {loading && <p className="page-note">Reading applications…</p>}

      {!loading && applications.length === 0 && (
        <p className="page-note">
          No applications yet. An application groups Pages you already have under one address, with a navigation and
          a route for each. Make one with New and add Pages to it.
        </p>
      )}

      {applications.map((one) => {
        const errors = one.problems.filter((problem) => problem.severity === 'error')
        const warnings = one.problems.filter((problem) => problem.severity === 'warning')
        return (
          <div className="page-block" key={one.applicationId}>
            <div className="page-row">
              <strong>{one.title}</strong>
              <span className="page-note">
                orbis://apps/{one.slug} · {one.pageCount} Page{one.pageCount === 1 ? '' : 's'}
              </span>
              <button type="button" className="page-chip" onClick={() => void startEdit(one)}>
                Edit
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${one.title}`}
                onClick={() => void remove(one)}
              >
                <Trash2 size={14} />
              </button>
            </div>

            {one.description !== '' && <p className="page-note">{one.description}</p>}

            {one.describes.map((line, index) => (
              <p className="page-note" key={index}>
                {line}
              </p>
            ))}

            {one.navigation.length > 0 && (
              <div className="page-chips" aria-label={`Routes in ${one.title}`}>
                {one.navigation
                  .filter((node) => node.kind === 'page' && node.route !== null)
                  .map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      className="page-chip"
                      onClick={() => void openRoute(one.applicationId, node.route as string)}
                    >
                      {node.label} <span className="page-note">{node.route}</span>
                    </button>
                  ))}
              </div>
            )}

            {errors.length > 0 && (
              <div role="alert">
                {errors.map((problem, index) => (
                  <p className="page-problem" key={index}>
                    <AlertTriangle size={12} aria-hidden /> {problem.message}
                  </p>
                ))}
              </div>
            )}

            {warnings.map((problem, index) => (
              <p className="page-note" key={index}>
                {problem.message}
              </p>
            ))}
          </div>
        )
      })}
    </div>
  )
}
