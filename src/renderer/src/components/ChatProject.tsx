import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { FolderOpen, FolderPlus } from 'lucide-react'
import { conversationRef, projectOfConversation, withProjectItem, withoutProjectItem, type Workspace } from '../../../shared/workspaces'
import type { NoticeKind } from '../lib/notices'

/**
 * Which project this conversation is kept in.
 *
 * A project could hold notes, tasks, research and pages, and not the one thing somebody setting one up almost always
 * wants in it: the conversation it is about. So a project could describe work and never be part of it.
 *
 * Putting a chat in a project is what makes that project's instructions apply to it -- every message, not only the
 * ones that happen to type the project's name. Nothing is copied: the project keeps a reference, so deleting the chat
 * removes it from the project and the project simply stops listing it.
 */
export default function ChatProject({ conversationId, onNotify }: { conversationId: string | null; onNotify(text: string, kind?: NoticeKind): void }): ReactElement | null {
  const [spaces, setSpaces] = useState<Workspace[] | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(() => {
    void window.api
      .listWorkspaces()
      .then((all) => setSpaces(all.workspaces.filter((one) => Boolean(one.project))))
      .catch(() => setSpaces([]))
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  // Knowing which project a chat is in means reading the projects, so it is read once rather than on every render.
  useEffect(() => {
    load()
  }, [load, conversationId])

  if (!conversationId || !spaces || spaces.length === 0) return null
  const home = projectOfConversation(conversationId, spaces)

  const put = (space: Workspace | null): void => {
    const ref = conversationRef(conversationId)
    const removals = spaces.filter((one) => one.id !== space?.id && one.project?.items.some((i) => i.ref === ref)).map((one) => window.api.saveWorkspace(withoutProjectItem(one, ref)))
    const addition = space ? [window.api.saveWorkspace(withProjectItem(space, ref))] : []
    void Promise.all([...removals, ...addition])
      .then(() => {
        load()
        setOpen(false)
        onNotify(space ? `This chat is in “${space.name}”. Orion will follow that project's instructions here.` : 'This chat is no longer in a project.')
      })
      .catch(() => onNotify('That project could not be changed.', 'error'))
  }

  return (
    <div className="chat-project">
      <button type="button" className="chat-project-btn" aria-expanded={open} onClick={() => setOpen((was) => !was)} title={home ? `In ${home.name}` : 'Not in a project'}>
        {home ? <FolderOpen size={13} aria-hidden="true" /> : <FolderPlus size={13} aria-hidden="true" />}
        {home ? home.name : 'No project'}
      </button>
      {open && (
        <ul className="chat-project-list">
          <li>
            <button type="button" className={home ? '' : 'on'} onClick={() => put(null)}>
              No project
            </button>
          </li>
          {spaces.map((one) => (
            <li key={one.id}>
              <button type="button" className={home?.id === one.id ? 'on' : ''} onClick={() => put(one)}>
                {one.name}
                {one.project?.instructions ? <span className="view-muted small"> · has instructions</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
