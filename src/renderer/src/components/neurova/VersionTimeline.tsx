import { useState } from 'react'
import type { Artifact, Project, Version } from '../../../../shared/neurova/project'

export interface VersionTimelineProps {
  project: Project
  /** Version ids that have been exported. */
  exportedIds: string[]
  onSelect: (versionId: string) => void
  onRestore: (versionId: string) => void
  onCompare: (aId: string, bId: string) => void
}

export function VersionTimeline({ project, exportedIds, onSelect, onRestore, onCompare }: VersionTimelineProps): React.JSX.Element {
  const [pair, setPair] = useState<string[]>([])
  const art = (v: Version): Artifact | undefined => project.artifacts.find((a) => a.id === v.artifactId)
  const depth = (v: Version): number => {
    let d = 0
    let pid = v.parentId
    while (pid && d < 20) {
      const next = project.versions.find((x) => x.id === pid)
      pid = next ? next.parentId : null
      d++
    }
    return d
  }
  const toggle = (id: string): void => setPair((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 2 ? [c[1], id] : [...c, id]))
  return (
    <section className="nv-timeline" aria-label="Versions">
      <div className="nv-x-head">
        <h3>Versions</h3>
        <button type="button" className="queue-btn" disabled={pair.length !== 2} onClick={() => onCompare(pair[0], pair[1])}>Compare two</button>
      </div>
      {project.versions.length === 0 ? <p className="nv-x-note">No versions yet.</p> : null}
      <ol className="nv-x-tl">
        {project.versions.map((v) => {
          const a = art(v)
          const sel = project.selectedVersionId === v.id
          return (
            <li key={v.id} className={`nv-x-tl-item${sel ? ' is-selected' : ''}`} style={{ marginInlineStart: `${Math.min(depth(v), 6) * 16}px` }}>
              <p>
                <strong>{v.name}</strong> <span className="nv-x-badge">{v.kind === 'restore' ? 'restored copy' : v.kind}</span>
                {sel ? <span className="nv-x-badge">selected</span> : null}
                {exportedIds.includes(v.id) ? <span className="nv-x-badge">exported</span> : null}
              </p>
              {v.parentId ? <p className="nv-x-note">From: {project.versions.find((x) => x.id === v.parentId)?.name ?? 'an earlier version'}</p> : null}
              {a?.derivedFrom ? <p className="nv-x-note">Processed: {a.derivedFrom.operation}</p> : null}
              {v.note ? <p className="nv-x-note">{v.note}</p> : null}
              <p className="nv-x-note">{new Date(v.createdAt).toLocaleString()}</p>
              <div className="nv-x-actions">
                <label className="nv-x-check"><input type="checkbox" checked={pair.includes(v.id)} onChange={() => toggle(v.id)} /><span>Compare {v.name}</span></label>
                <button type="button" className="queue-btn ghost" disabled={sel} onClick={() => onSelect(v.id)}>Select</button>
                <button type="button" className="queue-btn ghost" onClick={() => onRestore(v.id)}>Restore as copy</button>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
