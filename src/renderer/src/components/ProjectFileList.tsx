import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { FilePlus2, X } from 'lucide-react'
import type { ProjectFileView } from '../../../shared/types'
import type { NoticeKind } from '../lib/notices'

/**
 * The files a project keeps.
 *
 * A project could refer to a note or a saved page and could not hold a file, so the ordinary setup -- here is the
 * spec, the data and the style guide, now answer questions about this work -- meant attaching the same three files to
 * every message by hand, and forgetting one meant an answer confidently based on two of them.
 *
 * The size shown is how much text the file holds rather than how big it is on disk, because the text is what gets
 * searched and a 4 MB PDF of scans holds nothing at all.
 */
export default function ProjectFileList({ projectId, onNotify }: { projectId: string; onNotify(text: string, kind?: NoticeKind): void }): ReactElement {
  const [files, setFiles] = useState<ProjectFileView[]>([])
  // Why there is nothing to show, when there is a reason. No files and a file list that could not be read look
  // identical in the list itself, and this panel said "No files yet" for a project holding six of them.
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(() => {
    void window.api
      .projectFiles(projectId)
      .then((done) => {
        setFiles(done.files ?? [])
        setNote(done.message ?? null)
      })
      .catch(() => setFiles([]))
  }, [projectId])
  useEffect(load, [load])

  const add = (): void => {
    void window.api.addProjectFiles(projectId).then((done) => {
      if (done.files) setFiles(done.files)
      if (done.message) return onNotify(done.message, 'error')
      // Both halves are said: what went in, and what did not and why.
      if (done.added?.length) onNotify(`Added ${done.added.join(', ')}. Every chat in this project can use ${done.added.length === 1 ? 'it' : 'them'} now.`)
      for (const one of done.refused ?? []) onNotify(one, 'error')
    })
  }

  return (
    <div className="project-files">
      <div className="setting-row-inline">
        <button type="button" className="queue-btn small" onClick={add}>
          <FilePlus2 size={13} aria-hidden="true" /> Add files
        </button>
        <span className="view-muted small">{files.length === 0 ? (note ? 'Not being used' : 'No files yet') : `${files.length} file${files.length === 1 ? '' : 's'}, used by every chat in this project`}</span>
      </div>
      {note && <p className="project-files-note">{note}</p>}
      {files.length > 0 && (
        <ul className="blocked-list">
          {files.map((one) => (
            <li key={one.id}>
              <span>
                {one.name}
                <small className="skill-meta"> · {Math.max(1, Math.round(one.characters / 1000))}k characters of text</small>
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${one.name} from this project`}
                onClick={() => void window.api.removeProjectFile(projectId, one.id).then(load)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
