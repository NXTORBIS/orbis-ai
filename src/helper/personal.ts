import { NotesStore } from '../main/personal/notes.ts'
import { TasksStore } from '../main/personal/tasks.ts'
import { NOTE_COLORS, MAX_NOTE_BODY } from '../shared/notes.ts'
import type { Note, NoteFilter } from '../shared/notes.ts'
import { INBOX_LIST_ID, TASK_PRIORITIES } from '../shared/tasks.ts'
import type { Task, TaskFilter } from '../shared/tasks.ts'
import { HelperError } from './server.ts'
import type { Handler } from './server.ts'

/**
 * Notes and Tasks for the panel: the same NotesStore and TasksStore Electron Orbis uses, kept in this profile's own
 * data folder. The panel is trusted with the token, not with the shape of what it sends, so every argument is rebuilt
 * from known fields here and nothing else reaches the store.
 */

const bad = (message: string): HelperError => new HelperError('bad-request', message)

function obj(value: unknown, what: string): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw bad(`${what} must be an object.`)
  return value as Record<string, unknown>
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 80) throw bad('Expected an id.')
  return value
}
function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw bad(`${field} must be text of at most ${max} characters.`)
  return value
}
function flag(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw bad(`${field} must be true or false.`)
  return value
}
function stamp(value: unknown, field: string): number | undefined {
  if (value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) throw bad(`${field} must be a time.`)
  return value
}

export function noteFilter(raw: unknown): NoteFilter {
  const r = obj(raw, 'The filter')
  const f: NoteFilter = {}
  if (r.query !== undefined) f.query = text(r.query, 'query', 300)
  if (r.tag !== undefined) f.tag = text(r.tag, 'tag', 60)
  if (r.archived !== undefined) f.archived = flag(r.archived, 'archived')
  if (r.sort !== undefined) {
    if (r.sort !== 'updated' && r.sort !== 'created' && r.sort !== 'title') throw bad('Unknown sort.')
    f.sort = r.sort
  }
  return f
}

export function notePatch(raw: unknown): Partial<Note> {
  const r = obj(raw, 'The note')
  const p: Partial<Note> = {}
  if (r.title !== undefined) p.title = text(r.title, 'title', 500)
  if (r.body !== undefined) p.body = text(r.body, 'body', MAX_NOTE_BODY)
  if (r.tags !== undefined) {
    if (!Array.isArray(r.tags) || r.tags.length > 50) throw bad('tags must be a list of at most 50.')
    p.tags = r.tags.map((t) => text(t, 'tag', 60))
  }
  if (r.pinned !== undefined) p.pinned = flag(r.pinned, 'pinned')
  if (r.archived !== undefined) p.archived = flag(r.archived, 'archived')
  if (r.color !== undefined) {
    if (!NOTE_COLORS.includes(r.color as never)) throw bad('Unknown colour.')
    p.color = r.color as Note['color']
  }
  return p
}

export function taskFilter(raw: unknown): TaskFilter {
  const r = obj(raw, 'The filter')
  const f: TaskFilter = {}
  if (r.view !== undefined) {
    if (!['all', 'today', 'upcoming', 'overdue', 'completed', 'flagged', 'reminders'].includes(r.view as string)) throw bad('Unknown view.')
    f.view = r.view as TaskFilter['view']
  }
  if (r.listId !== undefined) f.listId = id(r.listId)
  if (r.query !== undefined) f.query = text(r.query, 'query', 300)
  if (r.sort !== undefined) {
    if (!['manual', 'due', 'priority', 'created', 'title'].includes(r.sort as string)) throw bad('Unknown sort.')
    f.sort = r.sort as TaskFilter['sort']
  }
  return f
}

export function taskPatch(raw: unknown): Partial<Task> {
  const r = obj(raw, 'The task')
  const p: Partial<Task> = {}
  if (r.title !== undefined) p.title = text(r.title, 'title', 500)
  if (r.notes !== undefined) p.notes = text(r.notes, 'notes', 20_000)
  if (r.listId !== undefined) p.listId = id(r.listId)
  if (r.due !== undefined) p.due = stamp(r.due, 'due')
  if (r.hasTime !== undefined) p.hasTime = flag(r.hasTime, 'hasTime')
  if (r.priority !== undefined) {
    if (!TASK_PRIORITIES.includes(r.priority as never)) throw bad('Unknown priority.')
    p.priority = r.priority as Task['priority']
  }
  if (r.subtasks !== undefined) {
    if (!Array.isArray(r.subtasks) || r.subtasks.length > 100) throw bad('subtasks must be a list of at most 100.')
    p.subtasks = r.subtasks.map((s) => {
      const o = obj(s, 'A subtask')
      return { id: id(o.id), title: text(o.title, 'subtask title', 500), done: flag(o.done, 'subtask done') }
    })
  }
  return p
}

/** `dataDir` is this profile's own folder; two profiles never share one. */
export function createPersonalHandlers(o: { dataDir: string }): Record<string, Handler> {
  if (!o.dataDir) throw new Error('Notes and tasks need a data folder.')
  const notes = new NotesStore(o.dataDir)
  const tasks = new TasksStore(o.dataDir)
  const first = (a: unknown[]): unknown => a[0]
  // Every answer is written to disk before it is sent, so nothing acknowledged can be lost to a quick shutdown.
  const saved = (run: (a: unknown[]) => Promise<unknown> | unknown): Handler => async (a) => {
    let result: unknown
    try {
      result = await run(a)
    } catch (err) {
      // The services word this one for the person; other failures stay in the helper.
      if (err instanceof Error && /no longer exists/.test(err.message)) throw new HelperError('not-found', err.message)
      throw err
    }
    await Promise.all([notes.flush(), tasks.flush()])
    return result
  }
  return {
    'notes:list': saved((a) => notes.search(noteFilter(first(a)))),
    'notes:tags': saved(() => notes.tags()),
    'notes:create': saved((a) => notes.create(notePatch(first(a)))),
    'notes:update': saved((a) => notes.update(id(a[0]), notePatch(a[1]))),
    'notes:delete': saved(async (a) => ({ removed: await notes.remove(id(a[0])) })),
    'notes:search': saved((a) => notes.search({ ...noteFilter(a[1]), query: text(a[0], 'query', 300) })),
    'tasks:snapshot': saved(() => tasks.snapshot()),
    'tasks:list': saved((a) => tasks.search(taskFilter(first(a)))),
    'tasks:create': saved(async (a) => {
      const p = taskPatch(first(a))
      if (!p.title?.trim()) throw bad('A task needs a title.')
      if (p.listId && p.listId !== INBOX_LIST_ID && !(await tasks.allLists()).some((l) => l.id === p.listId)) throw bad('There is no such list.')
      return tasks.create(p)
    }),
    'tasks:update': saved((a) => tasks.update(id(a[0]), taskPatch(a[1]))),
    'tasks:complete': saved((a) => tasks.complete(id(a[0]), flag(a[1], 'done'))),
    'tasks:delete': saved(async (a) => ({ removed: await tasks.remove(id(a[0])) })),
    'tasks:clear-completed': saved(async (a) => ({ cleared: await tasks.clearCompleted(a[0] === undefined ? undefined : id(a[0])) }))
  }
}
