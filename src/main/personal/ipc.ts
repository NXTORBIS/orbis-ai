import { ipcMain } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { ClipboardSettings, ClipItem, ClipKind } from '../../shared/clipboardHistory'
import type { Note, NoteFilter } from '../../shared/notes'
import type { Task, TaskFilter, TaskList } from '../../shared/tasks'
import type { BrowserControl } from '../browserControl/registry'
import { fail } from '../browserControl/registry'
import type { ClipboardHistory } from './clipboard'
import type { NotesStore } from './notes'
import type { TasksStore } from './tasks'

export interface PersonalIpcOptions {
  notes: NotesStore
  tasks: TasksStore
  clipboard: ClipboardHistory
  control: BrowserControl
  getWindow(): BrowserWindow | null
  /** The page in front: its address, title and the text the user has selected. */
  readPage(): Promise<{ url: string; title: string; selection?: string }>
  send(channel: string, ...args: unknown[]): void
}

const str = (value: unknown, max = 500): string => (typeof value === 'string' ? value.slice(0, max) : '')
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

/**
 * The Orbis window's access to notes, tasks and clipboard history, and the same things as capabilities of the Browser
 * Control Layer, so Orion and workflows use exactly one implementation of each.
 */
export function registerPersonalIpc(o: PersonalIpcOptions): void {
  const fromWindow = (event: IpcMainInvokeEvent): boolean => event.sender === o.getWindow()?.webContents
  const handle = (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!fromWindow(event)) throw new Error('Not allowed.')
      return handler(event, ...args)
    })
  }

  o.notes.onChange(() => o.send('notes:changed'))
  o.tasks.onChange(() => o.send('tasks:changed'))
  o.clipboard.onChange(() => o.send('clipboard:changed'))

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
  o.control.registerState('clips', async () => {
    const items = await o.clipboard.all()
    const settings = await o.clipboard.settings()
    return { count: items.length, paused: o.clipboard.isPaused(), enabled: settings.enabled, newest: items[0] ? { kind: items[0].kind, preview: items[0].preview, copiedAt: items[0].copiedAt } : null }
  })
}
