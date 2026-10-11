import { plainHandle } from '../ipc/handle.ts'
import type { BrowserWindow } from 'electron'
import type { ClipboardSettings, ClipItem, ClipKind } from '../../shared/clipboardHistory'
import type { Note, NoteFilter } from '../../shared/notes'
import type { Task, TaskFilter, TaskList } from '../../shared/tasks'
import type { BrowserControl } from '../browserControl/registry'
import { fail } from '../browserControl/registry'
import type { Board } from '../../shared/whiteboard'
import type { ClipboardHistory } from './clipboard'
import type { NotesStore } from './notes'
import type { TasksStore } from './tasks'
import type { WhiteboardStore } from './whiteboard'
import type { WorkspacesStore } from './workspaces'
import type { ProfilesStore } from './profiles'
import type { Profile } from '../../shared/profiles'
import type { Workspace } from '../../shared/workspaces'
import { openPlan } from '../../shared/workspaces'

export interface PersonalIpcOptions {
  notes: NotesStore
  tasks: TasksStore
  clipboard: ClipboardHistory
  whiteboard: WhiteboardStore
  workspaces: WorkspacesStore
  profiles: ProfilesStore
  /** Moves Orbis to another profile: its session, its browsing data and its pages. */
  switchProfile(id: string): Promise<{ profile: Profile }>
  control: BrowserControl
  getWindow(): BrowserWindow | null
  /** The page in front: its address, title and the text the user has selected. */
  readPage(): Promise<{ url: string; title: string; selection?: string }>
  /** A picture of the page in front, as a data URL. */
  pageImage(): Promise<{ dataUrl: string; width: number; height: number; url: string; title: string }>
  /** What the browser window holds right now (null when the browser is not open). */
  browserState(): { tabs: { url: string; title: string; pinned?: boolean; private?: boolean; muted?: boolean; active?: boolean; groupId?: string | null }[]; groups?: { id: string; name: string; color: string; collapsed?: boolean }[] } | null
  send(channel: string, ...args: unknown[]): void
}

const str = (value: unknown, max = 500): string => (typeof value === 'string' ? value.slice(0, max) : '')
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

/**
 * The Orbis window's access to notes, tasks and clipboard history, and the same things as capabilities of the Browser
 * Control Layer, so Orion and workflows use exactly one implementation of each.
 */
export function registerPersonalIpc(o: PersonalIpcOptions): void {
  const handle = plainHandle(o)

  o.notes.onChange(() => o.send('notes:changed'))
  o.tasks.onChange(() => o.send('tasks:changed'))
  o.clipboard.onChange(() => o.send('clipboard:changed'))
  o.whiteboard.onChange(() => o.send('whiteboard:changed'))
  o.workspaces.onChange(() => o.send('workspaces:changed'))
  o.profiles.onChange(() => o.send('profiles:list-changed'))

  // ---------------------------------------------------------------- notes

  handle('notes:list', (_e, filter) => o.notes.search(obj(filter) as NoteFilter))
  handle('notes:tags', () => o.notes.tags())
  handle('notes:get', (_e, id) => o.notes.get(str(id, 80)))
  handle('notes:create', (_e, patch) => o.notes.create(obj(patch) as Partial<Note>))
  handle('notes:save', (_e, note) => o.notes.save(note as Note))
  handle('notes:remove', (_e, id) => o.notes.remove(str(id, 80)))
  handle('notes:archive', (_e, id, archived) => o.notes.archive(str(id, 80), archived === true))
  handle('notes:from-page', async () => o.notes.fromPage(await o.readPage()))
  handle('notes:export', (_e, ids) => o.notes.exportMarkdown(Array.isArray(ids) ? ids.map((id) => str(id, 80)) : undefined))
  handle('notes:import', (_e, json) => o.notes.importJson(str(json, 20_000_000)))

  // ---------------------------------------------------------------- tasks

  handle('tasks:snapshot', () => o.tasks.snapshot())
  handle('tasks:list', (_e, filter) => o.tasks.search(obj(filter) as TaskFilter))
  handle('tasks:create', (_e, patch) => o.tasks.create(obj(patch) as Partial<Task>))
  handle('tasks:save', (_e, task) => o.tasks.save(task as Task))
  handle('tasks:update', (_e, id, patch) => o.tasks.update(str(id, 80), obj(patch) as Partial<Task>))
  handle('tasks:complete', (_e, id, done) => o.tasks.complete(str(id, 80), done === true))
  handle('tasks:remove', (_e, id) => o.tasks.remove(str(id, 80)))
  handle('tasks:clear-completed', (_e, listId) => o.tasks.clearCompleted(listId === undefined ? undefined : str(listId, 80)))
  handle('tasks:reorder', (_e, listId, ids) => o.tasks.reorder(str(listId, 80), Array.isArray(ids) ? ids.map((id) => str(id, 80)) : []))
  handle('tasks:save-list', (_e, list) => o.tasks.saveList(list as TaskList))
  handle('tasks:create-list', (_e, patch) => o.tasks.createList(obj(patch) as Partial<TaskList>))
  handle('tasks:remove-list', (_e, id) => o.tasks.removeList(str(id, 80)))
  handle('tasks:from-page', async (_e, listId) => o.tasks.fromPage(await o.readPage(), listId === undefined ? undefined : str(listId, 80)))

  // ---------------------------------------------------------------- clipboard history

  handle('clipboard:history', (_e, query, kind) => o.clipboard.search(str(query, 200), kind === undefined ? undefined : (str(kind, 20) as ClipKind | 'all' | 'pinned')))
  handle('clipboard:settings', () => o.clipboard.settings())
  handle('clipboard:update-settings', (_e, patch) => o.clipboard.updateSettings(obj(patch) as Partial<ClipboardSettings>))
  handle('clipboard:use', (_e, id) => o.clipboard.copyToClipboard(str(id, 80)))
  handle('clipboard:pin', (_e, id, pinned) => o.clipboard.setPinned(str(id, 80), pinned === true))
  handle('clipboard:remove', (_e, id) => o.clipboard.remove(str(id, 80)))
  handle('clipboard:clear', (_e, includePinned) => o.clipboard.clear(includePinned === true))
  handle('clipboard:paused', (_e, paused) => {
    if (paused !== undefined) o.clipboard.setPaused(paused === true)
    return { paused: o.clipboard.isPaused(), lastSkipped: o.clipboard.lastSkipped() }
  })

  // ---------------------------------------------------------------- whiteboards

  handle('whiteboard:list', () => o.whiteboard.list())
  handle('whiteboard:get', (_e, id) => o.whiteboard.get(str(id, 80)))
  handle('whiteboard:create', (_e, patch) => o.whiteboard.create(obj(patch) as Partial<Board>))
  handle('whiteboard:save', (_e, board) => o.whiteboard.save(board as Board))
  handle('whiteboard:remove', (_e, id) => o.whiteboard.remove(str(id, 80)))
  handle('whiteboard:rename', (_e, id, name) => o.whiteboard.rename(str(id, 80), str(name, 80)))
  handle('whiteboard:add', (_e, id, elements) => o.whiteboard.add(str(id, 80), Array.isArray(elements) ? elements : []))
  handle('whiteboard:export-svg', (_e, id) => o.whiteboard.exportSvg(str(id, 80)))
  handle('whiteboard:page-image', async (_e, id, at) => {
    const shot = await o.pageImage()
    const position = obj(at)
    const width = Math.min(640, shot.width)
    return o.whiteboard.add(str(id, 80), [
      {
        kind: 'image',
        at: { x: Number(position.x) || 0, y: Number(position.y) || 0 },
        width,
        height: Math.round((shot.height / Math.max(1, shot.width)) * width),
        src: shot.dataUrl,
        source: { url: shot.url, title: shot.title }
      }
    ])
  })

  // ---------------------------------------------------------------- workspaces

  /** Opens a workspace in the browser window, through the window's own capability, and says what really happened. */
  const openWorkspace = async (workspace: Workspace, replace: boolean): Promise<{ opened: number; groups: number; name: string }> => {
    const result = await o.control.execute(
      { capability: 'browser.openWorkspace', params: { tabs: workspace.tabs, groups: workspace.groups, replace }, target: {}, source: 'user' },
      { confirm: async () => true }
    )
    if (!result.ok) throw new Error(result.error?.message ?? 'The workspace could not be opened.')
    await o.workspaces.markOpened(workspace.id)
    const data = (result.data ?? {}) as { tabIds?: string[]; groups?: string[] }
    return { opened: data.tabIds?.length ?? 0, groups: data.groups?.length ?? 0, name: workspace.name }
  }

  handle('workspaces:list', async () => ({ workspaces: await o.workspaces.list(), currentId: o.workspaces.current() }))
  handle('workspaces:save-current', (_e, name, patch) => o.workspaces.saveCurrent(str(name, 60) || 'New workspace', o.browserState(), obj(patch) as Partial<Workspace>))
  handle('workspaces:update-current', (_e, id) => o.workspaces.updateFrom(str(id, 80), o.browserState()))
  handle('workspaces:save', (_e, workspace) => o.workspaces.save(workspace as Workspace))
  handle('workspaces:rename', (_e, id, name) => o.workspaces.rename(str(id, 80), str(name, 60)))
  handle('workspaces:remove', (_e, id) => o.workspaces.remove(str(id, 80)))
  handle('workspaces:duplicate', (_e, id) => o.workspaces.duplicate(str(id, 80)))
  handle('workspaces:reorder', (_e, ids) => o.workspaces.reorder(Array.isArray(ids) ? ids.map((id) => str(id, 80)) : []))
  handle('workspaces:plan', async (_e, id, replace) => {
    const workspace = await o.workspaces.get(str(id, 80))
    if (!workspace) throw new Error('That workspace no longer exists.')
    const state = o.browserState()
    return openPlan(workspace, { tabs: (state?.tabs ?? []).filter((t) => !t.private).map((t) => ({ url: t.url, title: t.title, pinned: t.pinned === true })) }, replace !== false)
  })
  handle('workspaces:open', async (_e, id, replace) => {
    const workspace = await o.workspaces.get(str(id, 80))
    if (!workspace) throw new Error('That workspace no longer exists.')
    return openWorkspace(workspace, replace !== false)
  })

  // ---------------------------------------------------------------- profiles

  handle('profiles:list', async () => ({ profiles: await o.profiles.list(), activeId: await o.profiles.activeId() }))
  handle('profiles:create', async (_e, name) => o.profiles.create({ name: str(name, 40) || 'New profile' }))
  handle('profiles:save', (_e, profile) => o.profiles.save(profile as Profile))
  handle('profiles:rename', (_e, id, name) => o.profiles.rename(str(id, 80), str(name, 40)))
  handle('profiles:remove', (_e, id) => o.profiles.remove(str(id, 80)))
  handle('profiles:switch', (_e, id) => o.switchProfile(str(id, 80)))

  // ---------------------------------------------------------------- capabilities

  const noteSummary = (note: Note): Record<string, unknown> => ({ id: note.id, title: note.title, preview: note.body.slice(0, 200), tags: note.tags, pinned: note.pinned, updatedAt: note.updatedAt, source: note.source?.url })
  const taskSummary = (task: Task): Record<string, unknown> => ({ id: task.id, title: task.title, listId: task.listId, done: task.done, due: task.due ?? null, priority: task.priority, subtasks: task.subtasks.length, link: task.link?.url })

  o.control.register({
    id: 'notes.search',
    domain: 'notes',
    name: 'Search notes',
    description: "The user's notes, newest first, optionally filtered by words or a tag. Bodies are shortened; use notes.get for one in full.",
    params: { query: { type: 'string', description: 'Words to look for.' }, tag: { type: 'string', description: 'Only notes with this tag.' }, archived: { type: 'boolean', description: 'Archived notes instead of current ones.' } },
    mutates: false,
    confirmation: 'none',
    run: async (p) => (await o.notes.search({ query: p.query as string, tag: p.tag as string, archived: p.archived === true })).slice(0, 50).map(noteSummary)
  })

  o.control.register({
    id: 'notes.get',
    domain: 'notes',
    name: 'Read a note',
    description: 'One note in full, by id.',
    params: { id: { type: 'string', description: 'The note id.', required: true } },
    mutates: false,
    confirmation: 'none',
    run: async (p) => (await o.notes.get(String(p.id))) ?? fail('not-found', 'There is no note with that id.', true)
  })

  o.control.register({
    id: 'notes.create',
    domain: 'notes',
    name: 'Create a note',
    description: 'Writes a new note. To keep something from the page in front, use notes.fromPage instead so the source is kept.',
    params: { title: { type: 'string', description: 'The title.' }, body: { type: 'string', description: 'The note itself (Markdown).' }, tags: { type: 'array', description: 'Tags.' } },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Create the note “${String(p.title ?? '').slice(0, 40) || 'Untitled'}”`,
    run: (p) => o.notes.create({ title: String(p.title ?? ''), body: String(p.body ?? ''), tags: Array.isArray(p.tags) ? p.tags.map(String) : [] }),
    verify: async (data) => {
      const note = data as Note
      const saved = await o.notes.get(note.id)
      return { verified: Boolean(saved), detail: saved ? `Saved “${saved.title || 'Untitled'}”.` : 'The note was not saved.' }
    }
  })

  o.control.register({
    id: 'notes.append',
    domain: 'notes',
    name: 'Add to a note',
    description: 'Adds text to the end of an existing note.',
    params: { id: { type: 'string', description: 'The note id.', required: true }, text: { type: 'string', description: 'What to add.', required: true } },
    mutates: true,
    confirmation: 'none',
    run: (p) => o.notes.append(String(p.id), String(p.text))
  })

  o.control.register({
    id: 'notes.fromPage',
    domain: 'notes',
    name: 'Save the page as a note',
    description: 'Makes a note from the page in front: its title, the text the user has selected (quoted), and a link back to it.',
    params: {},
    mutates: true,
    confirmation: 'none',
    run: async () => noteSummary(await o.notes.fromPage(await o.readPage()))
  })

  o.control.register({
    id: 'notes.delete',
    domain: 'notes',
    name: 'Delete a note',
    description: 'Deletes a note for good. Archiving (notes.archive) is usually better.',
    params: { id: { type: 'string', description: 'The note id.', required: true } },
    mutates: true,
    confirmation: 'always',
    describe: (p) => `Delete the note ${String(p.id).slice(0, 8)}`,
    run: async (p) => ({ deleted: await o.notes.remove(String(p.id)) }),
    verify: async (data, p) => {
      const gone = !(await o.notes.get(String(p.id)))
      return { verified: (data as { deleted: boolean }).deleted && gone, detail: gone ? 'The note is gone.' : 'The note is still there.' }
    }
  })

  o.control.register({
    id: 'notes.archive',
    domain: 'notes',
    name: 'Archive a note',
    description: 'Moves a note out of the way without deleting it (or brings it back).',
    params: { id: { type: 'string', description: 'The note id.', required: true }, archived: { type: 'boolean', description: 'True to archive, false to restore.', required: true } },
    mutates: true,
    confirmation: 'none',
    run: (p) => o.notes.archive(String(p.id), p.archived === true)
  })

  o.control.register({
    id: 'tasks.list',
    domain: 'tasks',
    name: 'List tasks',
    description: "The user's tasks: everything, or one view (today, upcoming, overdue, completed, flagged) or list.",
    params: {
      view: { type: 'string', description: 'Which tasks.', enum: ['all', 'today', 'upcoming', 'overdue', 'completed', 'flagged'] },
      listId: { type: 'string', description: 'Only this list.' },
      query: { type: 'string', description: 'Words to look for.' }
    },
    mutates: false,
    confirmation: 'none',
    run: async (p) => {
      const [tasks, lists] = await Promise.all([o.tasks.search({ view: p.view as TaskFilter['view'], listId: p.listId as string, query: p.query as string, sort: 'due' }), o.tasks.allLists()])
      return { lists: lists.map((l) => ({ id: l.id, name: l.name })), tasks: tasks.slice(0, 100).map(taskSummary) }
    }
  })

  o.control.register({
    id: 'tasks.create',
    domain: 'tasks',
    name: 'Create a task',
    description: 'Adds a task, optionally with a due date (a timestamp in milliseconds), priority and list.',
    params: {
      title: { type: 'string', description: 'What to do.', required: true },
      notes: { type: 'string', description: 'Any detail.' },
      due: { type: 'number', description: 'When it is due (milliseconds since 1970).' },
      hasTime: { type: 'boolean', description: 'True when the due date includes a time of day.' },
      priority: { type: 'string', description: 'How important.', enum: ['none', 'low', 'medium', 'high'] },
      listId: { type: 'string', description: 'Which list (tasks.list shows them).' }
    },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Create the task “${String(p.title).slice(0, 50)}”`,
    run: async (p) =>
      taskSummary(
        await o.tasks.create({
          title: String(p.title),
          notes: String(p.notes ?? ''),
          ...(typeof p.due === 'number' ? { due: p.due } : {}),
          hasTime: p.hasTime === true,
          priority: (p.priority as Task['priority']) ?? 'none',
          ...(typeof p.listId === 'string' ? { listId: p.listId } : {})
        })
      ),
    verify: async (data) => {
      const saved = await o.tasks.get((data as { id: string }).id)
      return { verified: Boolean(saved), detail: saved ? `Added “${saved.title}”.` : 'The task was not added.' }
    }
  })

  o.control.register({
    id: 'tasks.fromPage',
    domain: 'tasks',
    name: 'Make a task from the page',
    description: 'Adds a task for the page in front, keeping the link.',
    params: { listId: { type: 'string', description: 'Which list.' } },
    mutates: true,
    confirmation: 'none',
    run: async (p) => taskSummary(await o.tasks.fromPage(await o.readPage(), typeof p.listId === 'string' ? p.listId : undefined))
  })

  o.control.register({
    id: 'tasks.complete',
    domain: 'tasks',
    name: 'Tick a task off',
    description: 'Marks a task done (or not done). A repeating task moves to its next date instead of finishing.',
    params: { id: { type: 'string', description: 'The task id.', required: true }, done: { type: 'boolean', description: 'True to complete it.', required: true } },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const result = await o.tasks.complete(String(p.id), p.done === true)
      return { task: taskSummary(result.task), repeated: result.repeated }
    },
    verify: async (data) => {
      const { task, repeated } = data as { task: { id: string; done: boolean }; repeated: boolean }
      const saved = await o.tasks.get(task.id)
      return { verified: Boolean(saved) && saved!.done === task.done, detail: repeated ? 'Done for now; it comes back on its next date.' : saved?.done ? 'Ticked off.' : 'Marked as not done.' }
    }
  })

  o.control.register({
    id: 'tasks.update',
    domain: 'tasks',
    name: 'Change a task',
    description: 'Changes a task: its title, notes, due date, priority or list.',
    params: {
      id: { type: 'string', description: 'The task id.', required: true },
      title: { type: 'string', description: 'A new title.' },
      notes: { type: 'string', description: 'New detail.' },
      due: { type: 'number', description: 'A new due date (milliseconds since 1970).' },
      priority: { type: 'string', description: 'A new priority.', enum: ['none', 'low', 'medium', 'high'] },
      listId: { type: 'string', description: 'Move it to this list.' }
    },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const patch: Partial<Task> = {}
      if (typeof p.title === 'string') patch.title = p.title
      if (typeof p.notes === 'string') patch.notes = p.notes
      if (typeof p.due === 'number') patch.due = p.due
      if (typeof p.priority === 'string') patch.priority = p.priority as Task['priority']
      if (typeof p.listId === 'string') patch.listId = p.listId
      return taskSummary(await o.tasks.update(String(p.id), patch))
    }
  })

  o.control.register({
    id: 'tasks.delete',
    domain: 'tasks',
    name: 'Delete a task',
    description: 'Deletes a task for good.',
    params: { id: { type: 'string', description: 'The task id.', required: true } },
    mutates: true,
    confirmation: 'always',
    describe: (p) => `Delete the task ${String(p.id).slice(0, 8)}`,
    run: async (p) => ({ deleted: await o.tasks.remove(String(p.id)) })
  })

  o.control.register({
    id: 'clips.history',
    domain: 'clips',
    name: 'Clipboard history',
    description: 'What the user has copied recently (text, links, code and colours; images are listed by size only). The text itself is only read when the user asked for it.',
    params: { query: { type: 'string', description: 'Words to look for.' }, kind: { type: 'string', description: 'Only this kind.', enum: ['all', 'text', 'link', 'image', 'color', 'code', 'pinned'] }, limit: { type: 'integer', description: 'How many (default 20).' } },
    mutates: false,
    confirmation: 'when-consequential',
    assess: (_p, ctx) => (ctx.source === 'user' ? { decision: 'run', reason: '' } : { decision: 'confirm', reason: 'Clipboard history can hold private text.' }),
    run: async (p) => {
      const items = await o.clipboard.search(String(p.query ?? ''), (p.kind as ClipKind | 'all' | 'pinned') ?? 'all')
      return items.slice(0, Math.min(100, Number(p.limit) || 20)).map((c: ClipItem) => ({ id: c.id, kind: c.kind, preview: c.preview, pinned: c.pinned, copiedAt: c.copiedAt, times: c.times, source: c.source?.url }))
    }
  })

  o.control.register({
    id: 'clips.use',
    domain: 'clips',
    name: 'Copy an earlier entry again',
    description: 'Puts an entry from the clipboard history back on the clipboard, ready to paste.',
    params: { id: { type: 'string', description: 'The entry id from clips.history.', required: true } },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const item = await o.clipboard.copyToClipboard(String(p.id))
      return { kind: item.kind, preview: item.preview }
    }
  })

  o.control.register({
    id: 'clips.pin',
    domain: 'clips',
    name: 'Keep a clipboard entry',
    description: 'Pins an entry so it is kept however old it gets (or unpins it).',
    params: { id: { type: 'string', description: 'The entry id.', required: true }, pinned: { type: 'boolean', description: 'True to pin.', required: true } },
    mutates: true,
    confirmation: 'none',
    run: async (p) => (await o.clipboard.setPinned(String(p.id), p.pinned === true)) ?? fail('not-found', 'There is no entry with that id.', true)
  })

  o.control.register({
    id: 'clips.clear',
    domain: 'clips',
    name: 'Clear clipboard history',
    description: 'Empties the clipboard history. Pinned entries stay unless asked for as well.',
    params: { includePinned: { type: 'boolean', description: 'Also remove pinned entries.' } },
    mutates: true,
    confirmation: 'always',
    describe: (p) => (p.includePinned ? 'Clear the whole clipboard history, pinned entries included' : 'Clear the clipboard history'),
    run: async (p) => ({ removed: await o.clipboard.clear(p.includePinned === true) })
  })

  o.control.register({
    id: 'clips.pause',
    domain: 'clips',
    name: 'Pause clipboard history',
    description: 'Stops (or resumes) remembering what is copied. What is already there is kept.',
    params: { paused: { type: 'boolean', description: 'True to stop remembering.', required: true } },
    mutates: true,
    confirmation: 'none',
    run: (p) => {
      o.clipboard.setPaused(p.paused === true)
      return { paused: o.clipboard.isPaused() }
    }
  })

  o.control.register({
    id: 'whiteboard.list',
    domain: 'whiteboard',
    name: 'List whiteboards',
    description: 'The whiteboards the user has: id, name, how much is on each, and when each changed.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: () => o.whiteboard.list()
  })

  o.control.register({
    id: 'whiteboard.create',
    domain: 'whiteboard',
    name: 'Create a whiteboard',
    description: 'Starts a new, empty whiteboard.',
    params: { name: { type: 'string', description: 'What to call it.' } },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const board = await o.whiteboard.create({ ...(typeof p.name === 'string' && p.name ? { name: p.name } : {}) })
      return { id: board.id, name: board.name }
    }
  })

  o.control.register({
    id: 'whiteboard.addNote',
    domain: 'whiteboard',
    name: 'Put a note on a whiteboard',
    description: 'Adds a sticky note with some text to a whiteboard (whiteboard.list gives the ids).',
    params: {
      boardId: { type: 'string', description: 'Which board.', required: true },
      text: { type: 'string', description: 'What the note says.', required: true },
      x: { type: 'number', description: 'Where to put it across (default 0).' },
      y: { type: 'number', description: 'Where to put it down the board (default 0).' },
      color: { type: 'string', description: 'A colour such as #ffd866.' }
    },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Add a note to a whiteboard: ${JSON.stringify(String(p.text).slice(0, 40))}`,
    run: async (p) => {
      const board = await o.whiteboard.add(String(p.boardId), [{ kind: 'note', text: String(p.text), at: { x: Number(p.x) || 0, y: Number(p.y) || 0 }, width: 180, height: 140, ...(typeof p.color === 'string' ? { color: p.color } : {}) }])
      return { boardId: board.id, count: board.elements.length }
    },
    verify: async (data) => {
      const board = await o.whiteboard.get((data as { boardId: string }).boardId)
      return { verified: Boolean(board), detail: board ? `The board now holds ${board.elements.length} things.` : 'The board could not be read back.' }
    }
  })

  o.control.register({
    id: 'whiteboard.addPage',
    domain: 'whiteboard',
    name: 'Put the page on a whiteboard',
    description: 'Takes a picture of the page in front and puts it on a whiteboard, with a link back to the page.',
    params: { boardId: { type: 'string', description: 'Which board.', required: true }, x: { type: 'number', description: 'Where to put it across.' }, y: { type: 'number', description: 'Where to put it down the board.' } },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const shot = await o.pageImage()
      const width = Math.min(640, shot.width)
      const board = await o.whiteboard.add(String(p.boardId), [{ kind: 'image', at: { x: Number(p.x) || 0, y: Number(p.y) || 0 }, width, height: Math.round((shot.height / Math.max(1, shot.width)) * width), src: shot.dataUrl, source: { url: shot.url, title: shot.title } }])
      return { boardId: board.id, from: shot.url, count: board.elements.length }
    }
  })

  o.control.register({
    id: 'whiteboard.read',
    domain: 'whiteboard',
    name: 'Read a whiteboard',
    description: 'What is written and drawn on a board: its notes and text, and how many lines, shapes and pictures it holds.',
    params: { boardId: { type: 'string', description: 'Which board.', required: true } },
    mutates: false,
    confirmation: 'none',
    run: async (p) => {
      const board = (await o.whiteboard.get(String(p.boardId))) ?? fail('not-found', 'There is no board with that id.', true)
      const counts: Record<string, number> = {}
      for (const el of board.elements) counts[el.kind] = (counts[el.kind] ?? 0) + 1
      return {
        name: board.name,
        counts,
        text: board.elements.filter((el) => el.kind === 'note' || el.kind === 'text').map((el) => (el as { text: string }).text),
        pages: board.elements.filter((el) => el.kind === 'image' && el.source).map((el) => (el as { source?: { url: string } }).source?.url)
      }
    }
  })

  o.control.register({
    id: 'workspaces.list',
    domain: 'workspaces',
    name: 'List workspaces',
    description: 'The saved sets of pages the user can switch between: id, name, how many pages and groups, and the sites in each.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => {
      const list = await o.workspaces.list()
      const currentId = o.workspaces.current()
      return list.map((w) => ({ id: w.id, name: w.name, tabs: w.summary.tabs, groups: w.summary.groups, sites: w.summary.sites, open: w.id === currentId, lastOpenedAt: w.lastOpenedAt ?? null }))
    }
  })

  o.control.register({
    id: 'workspaces.open',
    domain: 'workspaces',
    name: 'Open a workspace',
    description: 'Switches the browser to a saved workspace. By default the pages that are not part of it are closed, so it asks first.',
    params: { workspace: { type: 'string', description: 'Workspace id or exact name.', required: true }, replace: { type: 'boolean', description: 'Close the other pages (default true).' } },
    mutates: true,
    confirmation: 'always',
    describe: (p) => `Open the workspace ${JSON.stringify(String(p.workspace))}${p.replace === false ? ' alongside what is open' : ', closing the other pages'}`,
    run: async (p) => {
      const all = await o.workspaces.list()
      const workspace = all.find((w) => w.id === p.workspace) ?? all.find((w) => w.name.toLowerCase() === String(p.workspace).toLowerCase())
      if (!workspace) return fail('not-found', `No workspace called ${JSON.stringify(String(p.workspace))}. See workspaces.list.`, true)
      return openWorkspace(workspace, p.replace !== false)
    },
    verify: async (data) => {
      const { opened, name } = data as { opened: number; name: string }
      return { verified: opened > 0, detail: opened > 0 ? `${name} is open with ${opened} page${opened === 1 ? '' : 's'}.` : 'Nothing was opened.' }
    }
  })

  o.control.register({
    id: 'workspaces.save',
    domain: 'workspaces',
    name: 'Save the open pages as a workspace',
    description: 'Saves the pages and groups that are open now as a workspace, under a name. Private tabs are never saved.',
    params: { name: { type: 'string', description: 'What to call it.', required: true } },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Save the open pages as the workspace ${JSON.stringify(String(p.name))}`,
    run: async (p) => {
      const saved = await o.workspaces.saveCurrent(String(p.name), o.browserState())
      return { id: saved.id, name: saved.name, tabs: saved.tabs.length, groups: saved.groups.length }
    },
    verify: async (data) => {
      const { id, tabs } = data as { id: string; tabs: number }
      const saved = await o.workspaces.get(id)
      return { verified: Boolean(saved) && saved!.tabs.length === tabs, detail: saved ? `Saved ${saved.tabs.length} page${saved.tabs.length === 1 ? '' : 's'}.` : 'The workspace was not saved.' }
    }
  })

  o.control.register({
    id: 'workspaces.update',
    domain: 'workspaces',
    name: 'Update a workspace',
    description: 'Brings a workspace up to date with the pages that are open now.',
    params: { workspace: { type: 'string', description: 'Workspace id or exact name.', required: true } },
    mutates: true,
    confirmation: 'when-consequential',
    run: async (p) => {
      const all = await o.workspaces.list()
      const workspace = all.find((w) => w.id === p.workspace) ?? all.find((w) => w.name.toLowerCase() === String(p.workspace).toLowerCase())
      if (!workspace) return fail('not-found', 'There is no workspace with that name.', true)
      const saved = await o.workspaces.updateFrom(workspace.id, o.browserState())
      return { id: saved.id, name: saved.name, tabs: saved.tabs.length }
    }
  })

  o.control.register({
    id: 'profiles.list',
    domain: 'profiles',
    name: 'List profiles',
    description: 'The separate browsing identities set up in Orbis, and which one is in use. Each keeps its own cookies, logins, history and bookmarks.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => {
      const activeId = await o.profiles.activeId()
      return (await o.profiles.list()).map((p) => ({ id: p.id, name: p.name, active: p.id === activeId, lastUsedAt: p.lastUsedAt }))
    }
  })

  o.control.register({
    id: 'profiles.switch',
    domain: 'profiles',
    name: 'Switch profile',
    description: 'Moves Orbis to another profile: its own logins, history and pages. The pages open now are put away with the profile they belong to.',
    params: { profile: { type: 'string', description: 'Profile id or exact name.', required: true } },
    mutates: true,
    confirmation: 'always',
    describe: (p) => `Switch to the profile ${JSON.stringify(String(p.profile))}`,
    run: async (p) => {
      const all = await o.profiles.list()
      const profile = all.find((x) => x.id === p.profile) ?? all.find((x) => x.name.toLowerCase() === String(p.profile).toLowerCase())
      if (!profile) return fail('not-found', `No profile called ${JSON.stringify(String(p.profile))}. See profiles.list.`, true)
      const result = await o.switchProfile(profile.id)
      return { id: result.profile.id, name: result.profile.name }
    },
    verify: async (data) => {
      const { id, name } = data as { id: string; name: string }
      const activeId = await o.profiles.activeId()
      return { verified: activeId === id, detail: activeId === id ? `${name} is the profile in use.` : 'The profile did not change.' }
    }
  })

  o.control.register({
    id: 'profiles.create',
    domain: 'profiles',
    name: 'Create a profile',
    description: 'Makes another browsing identity, with its own logins, history and bookmarks. It is not switched to.',
    params: { name: { type: 'string', description: 'What to call it.', required: true } },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const profile = await o.profiles.create({ name: String(p.name) })
      return { id: profile.id, name: profile.name }
    }
  })

  // State the rest of the control layer (and Orion) can read without a command.
  o.control.registerState('notes', async () => {
    const notes = await o.notes.search({})
    return { count: notes.length, recent: notes.slice(0, 10).map(noteSummary) }
  })
  o.control.registerState('tasks', async () => {
    const { lists, counts } = await o.tasks.snapshot()
    const today = await o.tasks.search({ view: 'today', sort: 'due' })
    return { counts, lists: lists.map((l) => ({ id: l.id, name: l.name })), today: today.slice(0, 20).map(taskSummary) }
  })
  o.control.registerState('profiles', async () => {
    const activeId = await o.profiles.activeId()
    const all = await o.profiles.list()
    return { active: all.find((p) => p.id === activeId)?.name ?? null, count: all.length, profiles: all.map((p) => ({ id: p.id, name: p.name, active: p.id === activeId })) }
  })
  o.control.registerState('workspaces', async () => {
    const list = await o.workspaces.list()
    const currentId = o.workspaces.current()
    return { count: list.length, current: list.find((w) => w.id === currentId)?.name ?? null, workspaces: list.slice(0, 20).map((w) => ({ id: w.id, name: w.name, tabs: w.summary.tabs })) }
  })
  o.control.registerState('whiteboard', async () => {
    const boards = await o.whiteboard.list()
    return { count: boards.length, boards: boards.slice(0, 10).map((b) => ({ id: b.id, name: b.name, things: b.count, updatedAt: b.updatedAt })) }
  })
  o.control.registerState('clips', async () => {
    const items = await o.clipboard.all()
    const settings = await o.clipboard.settings()
    return { count: items.length, paused: o.clipboard.isPaused(), enabled: settings.enabled, newest: items[0] ? { kind: items[0].kind, preview: items[0].preview, copiedAt: items[0].copiedAt } : null }
  })
}
