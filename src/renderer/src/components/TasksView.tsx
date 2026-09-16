import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, Check, ChevronRight, ExternalLink, Flag, Inbox, List, Plus, Repeat, Search, Trash2, X } from 'lucide-react'
import type { Task, TaskList, TaskPriority, TaskView as TaskViewName } from '../../../shared/tasks'
import { INBOX_LIST_ID, LIST_COLORS, parseTaskInput, startOfDay, TASK_PRIORITIES } from '../../../shared/tasks'
import type { NoticeKind } from '../App'

const VIEWS: { id: TaskViewName; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'flagged', label: 'Important' },
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Done' }
]

const PRIORITY_LABEL: Record<TaskPriority, string> = { none: 'No priority', low: 'Low', medium: 'Medium', high: 'High' }

function dueLabel(task: Task): string {
  if (task.due === undefined) return ''
  const date = new Date(task.due)
  const days = Math.round((startOfDay(task.due) - startOfDay(Date.now())) / 86_400_000)
  const time = task.hasTime ? ` ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''
  if (days === 0) return `Today${time}`
  if (days === 1) return `Tomorrow${time}`
  if (days === -1) return `Yesterday${time}`
  if (days > 1 && days < 7) return `${date.toLocaleDateString([], { weekday: 'long' })}${time}`
  return `${date.toLocaleDateString()}${time}`
}

const forInput = (task: Task): string => {
  if (task.due === undefined) return ''
  const d = new Date(task.due)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return task.hasTime ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Tasks: lists, due dates, priorities, subtasks and repeats. Typing "Pay rent tomorrow 9am !high #bills" fills in the
 * date, time, priority and list; everything is stored locally and shared with Orion through the control layer.
 */
export default function TasksView({ onClose, onNotify }: { onClose(): void; onNotify(message: string, kind?: NoticeKind): void }): React.JSX.Element {
  const [lists, setLists] = useState<TaskList[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [view, setView] = useState<TaskViewName>('today')
  const [listId, setListId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [counts, setCounts] = useState<Record<string, number>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  const load = async (): Promise<void> => {
    const snapshot = await window.api.tasksSnapshot()
    setLists(snapshot.lists)
    setTasks(snapshot.tasks)
    setCounts({ ...snapshot.counts.byList, today: snapshot.counts.today, overdue: snapshot.counts.overdue, upcoming: snapshot.counts.upcoming, flagged: snapshot.counts.flagged, all: snapshot.counts.open, completed: snapshot.counts.done })
  }

  useEffect(() => {
    void load()
    return window.api.onTasksChanged(() => void load())
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const now = Date.now()
    return tasks
      .filter((t) => (listId ? t.listId === listId : true))
      .filter((t) => {
        if (view === 'completed') return t.done
        if (t.done) return false
        if (view === 'today') return t.due !== undefined && startOfDay(t.due) <= startOfDay(now)
        if (view === 'upcoming') return t.due !== undefined && startOfDay(t.due) > startOfDay(now)
        if (view === 'overdue') return t.due !== undefined && (t.hasTime ? t.due < now : startOfDay(t.due) < startOfDay(now))
        if (view === 'flagged') return t.priority === 'high'
        return true
      })
      .filter((t) => !q || `${t.title} ${t.notes}`.toLowerCase().includes(q))
      .sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || a.order - b.order)
  }, [tasks, view, listId, query])

  const selected = useMemo(() => tasks.find((t) => t.id === selectedId) ?? null, [tasks, selectedId])

  const add = async (): Promise<void> => {
    const text = input.trim()
    if (!text) return
    const parsed = parseTaskInput(text, lists)
    if (!parsed.title) return
    await window.api.createTask({ ...parsed, listId: parsed.listId ?? listId ?? INBOX_LIST_ID })
    setInput('')
    inputRef.current?.focus()
  }

  const patch = (task: Task, change: Partial<Task>): void => void window.api.updateTask(task.id, change)

  const addList = async (): Promise<void> => {
    const list = await window.api.createTaskList({ name: 'New list', color: LIST_COLORS[lists.length % LIST_COLORS.length], order: lists.length })
    setListId(list.id)
    setView('all')
  }

  return (
    <div className="view tasks-view" role="region" aria-label="Tasks">
      <header className="view-head">
        <h2>Tasks</h2>
        <div className="view-actions">
          <button
            type="button"
            className="queue-btn"
            title="Make a task from the page you have open"
            onClick={() =>
              void window.api
                .taskFromPage(listId ?? undefined)
                .then((task) => onNotify(`Added “${task.title}”`))
                .catch((err: unknown) => onNotify(err instanceof Error ? err.message : 'No page open', 'error'))
            }
          >
            <ExternalLink size={14} /> From page
          </button>
          {view === 'completed' && (
            <button type="button" className="queue-btn" onClick={() => void window.api.clearCompletedTasks(listId ?? undefined).then((n) => onNotify(`Cleared ${n} finished task${n === 1 ? '' : 's'}`))}>
              <Trash2 size={14} /> Clear done
            </button>
          )}
          <button type="button" className="icon-btn" aria-label="Close tasks" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="tasks-body">
        <aside className="tasks-side" aria-label="Views and lists">
          <nav className="tasks-views">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" className={`tasks-nav${view === v.id && !listId ? ' on' : ''}`} onClick={() => (setView(v.id), setListId(null))}>
                {v.id === 'today' ? <CalendarClock size={14} /> : v.id === 'flagged' ? <Flag size={14} /> : v.id === 'completed' ? <Check size={14} /> : <List size={14} />}
                {v.label}
                {counts[v.id] ? <small>{counts[v.id]}</small> : null}
              </button>
            ))}
          </nav>
          <div className="tasks-lists">
            <div className="tasks-lists-head">
              <span>Lists</span>
              <button type="button" className="icon-btn" aria-label="New list" onClick={() => void addList()}>
                <Plus size={14} />
              </button>
            </div>
            {lists.map((list) => (
              <div key={list.id} className={`tasks-nav list${listId === list.id ? ' on' : ''}`}>
                <button type="button" className="tasks-list-pick" onClick={() => (setListId(list.id), setView('all'))}>
                  {list.id === INBOX_LIST_ID ? <Inbox size={14} /> : <span className="tasks-list-dot" style={{ background: list.color }} />}
                  <input
                    className="tasks-list-name"
                    value={list.name}
                    aria-label={`List name: ${list.name}`}
                    readOnly={list.id === INBOX_LIST_ID}
                    onChange={(e) => void window.api.saveTaskList({ ...list, name: e.target.value })}
                  />
                  {counts[list.id] ? <small>{counts[list.id]}</small> : null}
                </button>
                {list.id !== INBOX_LIST_ID && (
                  <button
                    type="button"
                    className="icon-btn danger"
                    aria-label={`Delete the list ${list.name}`}
                    title="Delete this list (its tasks move to the Inbox)"
                    onClick={() => void window.api.removeTaskList(list.id).then(() => (listId === list.id ? setListId(null) : undefined))}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </aside>

        <section className="tasks-main" aria-label="Tasks">
          <div className="tasks-toolbar">
            <label className="tasks-add">
              <Plus size={14} />
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void add()}
                placeholder="Add a task — try “Pay rent tomorrow 9am !high #bills”"
                aria-label="Add a task"
              />
              {input.trim() && (
                <button type="button" className="queue-btn small primary" onClick={() => void add()}>
                  Add
                </button>
              )}
            </label>
            <label className="tasks-search">
              <Search size={13} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search tasks" />
            </label>
          </div>

          <div className="tasks-items">
            {shown.map((task) => (
              <div key={task.id} className={`task-row${task.id === selectedId ? ' selected' : ''}${task.done ? ' done' : ''}`}>
                <button
                  type="button"
                  className={`task-check${task.done ? ' on' : ''}`}
                  aria-label={task.done ? `Mark “${task.title}” as not done` : `Mark “${task.title}” done`}
                  aria-pressed={task.done}
                  onClick={() => void window.api.completeTask(task.id, !task.done).then((r) => r.repeated && onNotify(`“${r.task.title}” comes back ${dueLabel(r.task).toLowerCase()}`))}
                >
                  {task.done && <Check size={12} />}
                </button>
                <button type="button" className="task-main" onClick={() => setSelectedId(task.id === selectedId ? null : task.id)}>
                  <span className="task-title">{task.title || 'Untitled task'}</span>
                  <span className="task-meta">
                    {task.priority === 'high' && <Flag size={11} className="task-flag" />}
                    {task.repeat && <Repeat size={11} />}
                    {task.due !== undefined && <span className={task.due < Date.now() && !task.done ? 'task-due late' : 'task-due'}>{dueLabel(task)}</span>}
                    {task.subtasks.length > 0 && (
                      <span>
                        {task.subtasks.filter((s) => s.done).length}/{task.subtasks.length}
                      </span>
                    )}
                    {task.link && <ExternalLink size={11} />}
                    {!listId && lists.find((l) => l.id === task.listId)?.id !== INBOX_LIST_ID && <span className="task-list">{lists.find((l) => l.id === task.listId)?.name}</span>}
                  </span>
                </button>
                <ChevronRight size={14} className="task-chevron" aria-hidden="true" />
              </div>
            ))}
            {!shown.length && <p className="view-empty">{query ? 'No tasks match.' : view === 'completed' ? 'Nothing finished yet.' : view === 'today' ? 'Nothing due today.' : 'No tasks here. Add one above.'}</p>}
          </div>
        </section>

        {selected && (
          <section className="task-detail" aria-label={`Task: ${selected.title}`}>
            <div className="task-detail-head">
              <input className="task-detail-title" value={selected.title} aria-label="Task title" onChange={(e) => patch(selected, { title: e.target.value })} />
              <button type="button" className="icon-btn" aria-label="Close task details" onClick={() => setSelectedId(null)}>
                <X size={15} />
              </button>
            </div>
            <label className="task-field">
              <span>Due</span>
              <input
                type={selected.hasTime ? 'datetime-local' : 'date'}
                value={forInput(selected)}
                aria-label="Due date"
                onChange={(e) => patch(selected, e.target.value ? { due: new Date(e.target.value).getTime(), hasTime: e.target.value.includes('T') } : { due: undefined })}
              />
              <button type="button" className="queue-btn small" onClick={() => patch(selected, { hasTime: !selected.hasTime })}>
                {selected.hasTime ? 'Day only' : 'Add a time'}
              </button>
            </label>
            <label className="task-field">
              <span>Priority</span>
              <select value={selected.priority} aria-label="Priority" onChange={(e) => patch(selected, { priority: e.target.value as TaskPriority })}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="task-field">
              <span>List</span>
              <select value={selected.listId} aria-label="List" onChange={(e) => patch(selected, { listId: e.target.value })}>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="task-field">
              <span>Repeats</span>
              <select
                value={selected.repeat ? `${selected.repeat.every}:${selected.repeat.interval}` : ''}
                aria-label="Repeat"
                onChange={(e) => patch(selected, e.target.value ? { repeat: { every: e.target.value.split(':')[0] as 'day' | 'week' | 'month' | 'year', interval: Number(e.target.value.split(':')[1]) } } : { repeat: undefined })}
              >
                <option value="">Never</option>
                <option value="day:1">Every day</option>
                <option value="week:1">Every week</option>
                <option value="week:2">Every two weeks</option>
                <option value="month:1">Every month</option>
                <option value="year:1">Every year</option>
              </select>
            </label>
            <div className="task-subtasks">
              <span className="task-field-label">Steps</span>
              {selected.subtasks.map((sub) => (
                <div key={sub.id} className="task-subtask">
                  <button
                    type="button"
                    className={`task-check small${sub.done ? ' on' : ''}`}
                    aria-label={sub.done ? `Mark “${sub.title}” as not done` : `Mark “${sub.title}” done`}
                    onClick={() => patch(selected, { subtasks: selected.subtasks.map((s) => (s.id === sub.id ? { ...s, done: !s.done } : s)) })}
                  >
                    {sub.done && <Check size={10} />}
                  </button>
                  <input value={sub.title} aria-label="Step" onChange={(e) => patch(selected, { subtasks: selected.subtasks.map((s) => (s.id === sub.id ? { ...s, title: e.target.value } : s)) })} />
                  <button type="button" className="icon-btn danger" aria-label={`Remove the step ${sub.title}`} onClick={() => patch(selected, { subtasks: selected.subtasks.filter((s) => s.id !== sub.id) })}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <button type="button" className="queue-btn small" onClick={() => patch(selected, { subtasks: [...selected.subtasks, { id: crypto.randomUUID(), title: '', done: false }] })}>
                <Plus size={12} /> Add a step
              </button>
            </div>
            <textarea className="task-notes" value={selected.notes} placeholder="Notes" aria-label="Task notes" onChange={(e) => patch(selected, { notes: e.target.value })} />
            {selected.link && (
              <button type="button" className="task-link" onClick={() => void window.api.executeControl({ capability: 'navigation.go', params: { url: selected.link!.url } })}>
                <ExternalLink size={12} /> {selected.link.title || selected.link.url}
              </button>
            )}
            <button
              type="button"
              className="queue-btn danger"
              onClick={() => void window.api.removeTask(selected.id).then(() => (setSelectedId(null), onNotify('Task deleted')))}
            >
              <Trash2 size={13} /> Delete task
            </button>
          </section>
        )}
      </div>
    </div>
  )
}
