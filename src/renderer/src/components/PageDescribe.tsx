import { useCallback, useEffect, useState } from 'react'
import { History, Loader2, Sparkles, Trash2, Wand2 } from 'lucide-react'

import type { NoticeKind } from '../App'
import type { PageDocument } from '../../../shared/pages/builder'
import { PreviewComponent, useDocumentRunner } from './PageStudio'

/**
 * Asking Orbis for a Page that does not exist yet.
 *
 * The screen is deliberately three steps rather than one, and the middle one is the point: a request is made, a Page
 * comes back, and **then** somebody decides whether to keep it. A model writing a calculator that silently joins
 * somebody's library is a library nobody can trust, because there is no way afterwards to tell what was asked for
 * from what was invented.
 *
 * So everything that would normally be hidden is shown here: what it went through, what it is allowed to do, what it
 * says it cannot do, and the Page itself, running, before it is anybody's.
 */

type Generated = {
  stage: string
  sessionId: string
  history: { stage: string; at: number; note: string }[]
  failure: { code: string; message: string; problems: string[] } | null
  gates: { gate: string; outcome: string; because: string[] }[]
  because: string[]
  insteadOpen: string | null
  page: {
    pageId: string
    manifest: {
      slug: string
      title: string
      description: string
      icon: string
      capabilities: string[]
      capabilityReasons: Record<string, string>
      limitations: string[]
      categories: string[]
    }
    document: unknown
  } | null
}

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && 'error' in value

/** What a stage is called on screen. The words a person would use, not the words the state machine uses. */
const STAGE_WORDS: Readonly<Record<string, string>> = {
  resolving: 'Looking for a Page that already does this',
  planning: 'Working out what the Page should be',
  compiling: 'Building it',
  validating: 'Checking it',
  trying: 'Running it',
  ready: 'Ready',
  failed: 'It did not work',
  cancelled: 'Stopped'
}

export function DescribePanel({
  onNotify,
  onOpened
}: {
  onNotify(message: string, kind?: NoticeKind): void
  onOpened?(url: string): void
}): React.JSX.Element {
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const [built, setBuilt] = useState<Generated | null>(null)
  const [mine, setMine] = useState<{ sessionId: string; request: string; stage: string; updatedAt: number; code: string; message: string }[]>([])

  const loadSessions = useCallback(async () => {
    const result = await window.api.pagesGenerateSessions()
    if (refused(result)) return
    setMine([...result.sessions].reverse().slice(0, 8))
  }, [])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  const build = useCallback(async () => {
    const asked = request.trim()
    if (asked.length === 0) return
    setBusy(true)
    setBuilt(null)
    try {
      const result = await window.api.pagesGenerate(asked)
      if (refused(result)) {
        onNotify(result.message ?? 'That did not work.', 'error')
        return
      }
      setBuilt(result)
      if (result.page === null) {
        onNotify(result.failure?.message ?? result.because[0] ?? 'Nothing was built.')
      }
    } finally {
      setBusy(false)
      void loadSessions()
    }
  }, [request, onNotify, loadSessions])

  const keep = useCallback(async () => {
    if (built?.page == null) return
    const result = await window.api.pagesGenerateKeep(built.page.pageId)
    if (refused(result)) {
      onNotify(result.message ?? 'That did not work.', 'error')
      return
    }
    if (!result.kept) {
      onNotify(result.message, 'error')
      return
    }
    onNotify(`"${built.page.manifest.title}" is in your library.`)
    if (result.url !== null) onOpened?.(result.url)
    setBuilt(null)
    setRequest('')
  }, [built, onNotify, onOpened])

  const discard = useCallback(async () => {
    if (built?.page == null) return
    await window.api.pagesGenerateDiscard(built.page.pageId)
    setBuilt(null)
  }, [built])

  return (
    <div className="studio-list">
      <section className="studio-group">
        <h4 className="studio-h">Describe a Page</h4>
        <p className="page-note">
          Say what you want worked out. Orbis looks for a Page that already does it first, and only builds one when
          nothing does.
        </p>
        <label className="page-field wide">
          <span>What should it work out?</span>
          <input
            value={request}
            maxLength={400}
            placeholder="work out the terminal velocity of a falling raindrop"
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) void build()
            }}
          />
        </label>
        <div className="studio-row">
          <button type="button" className="queue-btn small" disabled={busy || request.trim().length === 0} onClick={() => void build()}>
            {busy ? <Loader2 size={12} className="spin" /> : <Wand2 size={12} />} {busy ? 'Building' : 'Build it'}
          </button>
          {busy && <span className="page-note">This asks a model to write it, so it takes a moment.</span>}
        </div>
      </section>

      {built !== null && <Outcome built={built} onKeep={() => void keep()} onDiscard={() => void discard()} onNotify={onNotify} />}

      {mine.length > 0 && (
        <section className="studio-group">
          <h4 className="studio-h">
            <History size={12} /> Recently
          </h4>
          {/* Including the ones that did not work. A feature that only shows its successes is one nobody can debug. */}
          <ul className="page-list">
            {mine.map((one) => (
              <li key={one.sessionId}>
                <span className="page-label">{one.request}</span>
                <span className="page-note">
                  {/* A request nothing needed building for is not a request that failed. */}
                  {one.code === 'nothing-to-build'
                    ? 'Nothing needed building'
                    : one.code === 'cannot-be-built'
                      ? 'Orbis cannot work this out'
                      : (STAGE_WORDS[one.stage] ?? one.stage)}
                  {one.message === '' ? '' : ` — ${one.message}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Outcome({
  built,
  onKeep,
  onDiscard,
  onNotify
}: {
  built: Generated
  onKeep(): void
  onDiscard(): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  if (built.page === null) {
    // Nothing being built is not the same as something going wrong, and the two must not read alike. Being handed a
    // Page that already does the job is the *best* outcome of the ladder -- saying "it did not work" there would
    // teach somebody that the feature is unreliable when what happened is that it worked perfectly.
    const heading =
      built.insteadOpen !== null
        ? 'There is already a Page for this'
        : built.failure?.code === 'nothing-to-build'
          ? 'Nothing needed building'
          : built.failure?.code === 'cannot-be-built'
            ? 'Orbis cannot work this out'
            : (STAGE_WORDS[built.stage] ?? built.stage)
    // The failure message and the reasons overlap: the same sentence arrives on both when the ladder is what ended
    // it. Shown once.
    const reasons = [
      ...new Set([
        ...(built.failure === null ? [] : [built.failure.message, ...built.failure.problems]),
        ...built.because
      ])
    ]
    return (
      <section className="studio-group">
        <h4 className="studio-h">{heading}</h4>
        {built.insteadOpen !== null && (
          <p className="page-note">
            <code>{built.insteadOpen}</code>
          </p>
        )}
        {/* The reasons, all of them. A refusal somebody cannot argue with is one they cannot work around either. */}
        <ul className="page-list">
          {reasons.map((one, i) => (
            <li key={i} className="page-note">
              {one}
            </li>
          ))}
        </ul>
        <Gates gates={built.gates} />
      </section>
    )
  }

  const manifest = built.page.manifest
  return (
    <section className="studio-group">
      <h4 className="studio-h">
        <Sparkles size={12} /> {manifest.title}
      </h4>
      <p className="page-note">{manifest.description}</p>

      <div className="studio-row">
        <button type="button" className="queue-btn small" onClick={onKeep}>
          Keep it
        </button>
        <button type="button" className="queue-btn small ghost" onClick={onDiscard}>
          <Trash2 size={12} /> Throw it away
        </button>
      </div>

      <h4 className="studio-h">It is allowed to</h4>
      <ul className="page-list">
        {manifest.capabilities.length === 0 && <li className="page-note">Nothing at all.</li>}
        {manifest.capabilities.map((one) => (
          <li key={one}>
            <span className="page-label">{one}</span>
            <span className="page-note">{manifest.capabilityReasons[one] ?? ''}</span>
          </li>
        ))}
      </ul>

      <h4 className="studio-h">What it does not do</h4>
      <ul className="page-list">
        {manifest.limitations.map((one, i) => (
          <li key={i} className="page-note">
            {one}
          </li>
        ))}
      </ul>

      <Gates gates={built.gates} />

      <h4 className="studio-h">Try it</h4>
      {/*
        The real thing, running under the Page's own identity, before anybody keeps it. Everything a Page shows comes
        back from an engine through `pages:compute`, so this is not a preview of what it would do -- it is what it does.
      */}
      <RunDocument pageId={built.page.pageId} document={built.page.document as PageDocument} onNotify={onNotify} pending />
    </section>
  )
}

function Gates({ gates }: { gates: { gate: string; outcome: string; because: string[] }[] }): React.JSX.Element | null {
  if (gates.length === 0) return null
  return (
    <>
      <h4 className="studio-h">What was checked</h4>
      <ul className="page-list">
        {gates.map((one) => (
          <li key={one.gate}>
            <span className="page-label">
              {one.gate} — {one.outcome === 'not-run' ? 'not checked' : one.outcome}
            </span>
            {one.because.map((why, i) => (
              <span key={i} className="page-note">
                {why}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * A generated Page's versions, and the two things somebody can do about them.
 *
 * Rebuilding adds a version beside the one in use; it never replaces it. Publishing chooses which one opens. That is
 * why going back is one click and not another wait: the version that already worked is still here, exactly as it was,
 * rather than being asked for a third time and coming back slightly different.
 */
export function GeneratedHistory({
  pageId,
  onNotify,
  onChanged
}: {
  pageId: string
  onNotify(message: string, kind?: NoticeKind): void
  onChanged?(): void
}): React.JSX.Element | null {
  const [versions, setVersions] = useState<
    { versionId: string; version: string; state: string; reason: string | null; createdAt: number; title: string }[]
  >([])
  const [publishedVersionId, setPublished] = useState<string | null>(null)
  const [change, setChange] = useState('')
  const [busy, setBusy] = useState(false)
  const [dropped, setDropped] = useState<{ name: string; label: string; why: string }[]>([])
  const [changes, setChanges] = useState<{ kind: string; what: string; name: string; message: string }[]>([])

  const load = useCallback(async () => {
    const result = await window.api.pagesGenerateHistory(pageId)
    if (refused(result)) {
      setVersions([])
      return
    }
    setVersions(result.versions)
    setPublished(result.publishedVersionId)
  }, [pageId])

  useEffect(() => {
    void load()
  }, [load])

  const rebuild = useCallback(async () => {
    const asked = change.trim()
    if (asked.length === 0) return
    setBusy(true)
    setDropped([])
    setChanges([])
    try {
      const result = await window.api.pagesGenerateRebuild(pageId, asked)
      if (refused(result)) {
        onNotify(result.message ?? 'That did not work.', 'error')
        return
      }
      if (result.version === null) {
        onNotify(result.message, 'error')
        return
      }
      setChanges(result.changes)
      setDropped(result.dropped)
      // Said rather than done. A new version is a draft beside the one in use, and publishing it is a decision.
      onNotify(`Version ${result.version.version} is ready. It is not in use until you publish it.`)
      setChange('')
      await load()
    } finally {
      setBusy(false)
    }
  }, [pageId, change, onNotify, load])

  const publish = useCallback(
    async (versionId: string) => {
      const result = await window.api.pagesGeneratePublish(pageId, versionId)
      if (refused(result) || !result.published) {
        onNotify((refused(result) ? result.message : result.message) ?? 'That did not work.', 'error')
        return
      }
      await load()
      onChanged?.()
    },
    [pageId, onNotify, load, onChanged]
  )

  if (versions.length === 0) return null

  return (
    <section className="studio-group">
      <h4 className="studio-h">
        <History size={12} /> Versions
      </h4>
      <ul className="page-list">
        {versions.map((one) => (
          <li key={one.versionId}>
            <span className="page-label">
              {one.version} {one.versionId === publishedVersionId ? '(in use)' : `(${one.state})`}
            </span>
            <span className="page-note">{one.reason ?? 'the first version'}</span>
            {one.versionId !== publishedVersionId && (
              <button type="button" className="queue-btn small ghost" onClick={() => void publish(one.versionId)}>
                Use this one
              </button>
            )}
          </li>
        ))}
      </ul>

      {changes.length > 0 && (
        <>
          <h4 className="studio-h">What changed</h4>
          <ul className="page-list">
            {changes.map((one, i) => (
              <li key={i} className="page-note">
                {one.message}
              </li>
            ))}
          </ul>
        </>
      )}
      {dropped.length > 0 && (
        <>
          {/* Said before it happens rather than discovered afterwards. Nothing is converted or clamped to make a
              value fit: that would turn somebody's number into a different number without saying so. */}
          <h4 className="studio-h">What would not carry over</h4>
          <ul className="page-list">
            {dropped.map((one) => (
              <li key={one.name} className="page-note">
                {one.label}: {one.why}
              </li>
            ))}
          </ul>
        </>
      )}

      <label className="page-field wide">
        <span>Change something about it</span>
        <input
          value={change}
          maxLength={300}
          placeholder="show the height as well"
          onChange={(e) => setChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) void rebuild()
          }}
        />
      </label>
      <button type="button" className="queue-btn small" disabled={busy || change.trim().length === 0} onClick={() => void rebuild()}>
        {busy ? <Loader2 size={12} className="spin" /> : <Wand2 size={12} />} {busy ? 'Building' : 'Build it again'}
      </button>
    </section>
  )
}

/**
 * A built Page, running.
 *
 * Through `useDocumentRunner`, which is the same hook the builder's preview uses and the same `pages:compute` channel
 * every other Page uses. There is no second runtime for Pages that were generated, which is the whole reason the
 * compiler produces an ordinary `PageDocument` rather than something of its own.
 */
export function RunDocument({
  pageId,
  document,
  onNotify,
  pending = false
}: {
  pageId: string
  document: PageDocument
  onNotify(message: string, kind?: NoticeKind): void
  /** True while the Page is built and not yet kept, when the register does not know about it. */
  pending?: boolean
}): React.JSX.Element {
  const { state, running, change, run } = useDocumentRunner(document, pageId, onNotify, pending)
  return (
    <div className="studio-preview" aria-busy={running}>
      {document.components.map((component) => (
        <PreviewComponent
          key={component.id}
          component={component}
          document={document}
          state={state}
          onChange={(name, value) => void change(name, value)}
          onRun={(name) => void run(name)}
        />
      ))}
    </div>
  )
}
