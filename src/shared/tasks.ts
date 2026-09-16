/**
 * Tasks: lists, tasks with subtasks, due dates and repeats, and the rules for sorting, filtering, completing and
 * rescheduling them. Pure — no storage, no browser.
 */

export interface Subtask {
  id: string
  title: string
  done: boolean
}

export type TaskPriority = 'none' | 'low' | 'medium' | 'high'

export interface TaskRepeat {
  every: 'day' | 'week' | 'month' | 'year'
  interval: number
}

export interface TaskLink {
  url: string
  title: string
}

export interface Task {
  id: string
  listId: string
  title: string
  notes: string
  done: boolean
  completedAt?: number
  /** Midnight-based timestamp for a day, or an exact time when the task has one. */
  due?: number
  hasTime: boolean
  priority: TaskPriority
  repeat?: TaskRepeat
  subtasks: Subtask[]
  link?: TaskLink
  /** Position within its list, low first. */
  order: number
  createdAt: number
  updatedAt: number
}

export interface TaskList {
  id: string
  name: string
  color: string
  order: number
  createdAt: number
}

export const TASK_PRIORITIES: TaskPriority[] = ['none', 'low', 'medium', 'high']
export const LIST_COLORS = ['#3fd8ff', '#3ee58a', '#ffbe4d', '#ff4d6d', '#a78bfa', '#f472b6']
export const INBOX_LIST_ID = 'inbox'

const now = (): number => Date.now()

export const newList = (patch: Partial<TaskList> = {}): TaskList => ({ id: patch.id ?? crypto.randomUUID(), name: 'New list', color: LIST_COLORS[0], order: 0, createdAt: now(), ...patch })

export const newTask = (patch: Partial<Task> = {}): Task => ({
  id: patch.id ?? crypto.randomUUID(),
  listId: INBOX_LIST_ID,
  title: '',
  notes: '',
  done: false,
  hasTime: false,
  priority: 'none',
  subtasks: [],
  order: 0,
  createdAt: now(),
  updatedAt: now(),
  ...patch
})

export function normalizeList(raw: unknown): TaskList | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<TaskList>
  if (typeof r.id !== 'string' || !r.id) return null
  return {
    id: r.id,
    name: (typeof r.name === 'string' ? r.name : '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Untitled list',
    color: typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : LIST_COLORS[0],
    order: Number(r.order) || 0,
    createdAt: Number(r.createdAt) || now()
  }
}

export function normalizeTask(raw: unknown): Task | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<Task>
  if (typeof r.id !== 'string' || !r.id) return null
  const repeat = r.repeat && ['day', 'week', 'month', 'year'].includes(r.repeat.every) ? { every: r.repeat.every, interval: Math.min(365, Math.max(1, Math.round(Number(r.repeat.interval) || 1))) } : undefined
  const link = r.link && typeof r.link.url === 'string' && r.link.url ? { url: r.link.url.slice(0, 2048), title: String(r.link.title ?? '').slice(0, 300) } : undefined
  return {
    id: r.id,
    listId: typeof r.listId === 'string' && r.listId ? r.listId : INBOX_LIST_ID,
    title: (typeof r.title === 'string' ? r.title : '').replace(/\s+/g, ' ').trim().slice(0, 300),
    notes: (typeof r.notes === 'string' ? r.notes : '').slice(0, 10_000),
    done: r.done === true,
    ...(r.done && Number(r.completedAt) ? { completedAt: Number(r.completedAt) } : {}),
    ...(Number.isFinite(Number(r.due)) && Number(r.due) > 0 ? { due: Number(r.due) } : {}),
    hasTime: r.hasTime === true,
    priority: TASK_PRIORITIES.includes(r.priority as TaskPriority) ? (r.priority as TaskPriority) : 'none',
    ...(repeat ? { repeat } : {}),
    subtasks: (Array.isArray(r.subtasks) ? r.subtasks : [])
      .filter((s): s is Subtask => Boolean(s && typeof s === 'object' && typeof (s as Subtask).id === 'string'))
      .map((s) => ({ id: s.id, title: String(s.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200), done: s.done === true }))
      .slice(0, 50),
    ...(link ? { link } : {}),
    order: Number(r.order) || 0,
    createdAt: Number(r.createdAt) || now(),
    updatedAt: Number(r.updatedAt) || Number(r.createdAt) || now()
  }
}

// ---------------------------------------------------------------- dates

export const startOfDay = (time: number): number => {
  const d = new Date(time)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export const isOverdue = (task: Task, time = now()): boolean => !task.done && task.due !== undefined && (task.hasTime ? task.due < time : task.due < startOfDay(time))

export const isDueToday = (task: Task, time = now()): boolean => task.due !== undefined && startOfDay(task.due) === startOfDay(time)

/** When a repeating task is next due after the given date. */
export function nextDue(due: number, repeat: TaskRepeat): number {
  const d = new Date(due)
  if (repeat.every === 'day') d.setDate(d.getDate() + repeat.interval)
  else if (repeat.every === 'week') d.setDate(d.getDate() + 7 * repeat.interval)
  else if (repeat.every === 'month') d.setMonth(d.getMonth() + repeat.interval)
  else d.setFullYear(d.getFullYear() + repeat.interval)
  return d.getTime()
}

/**
 * Completing a task. A repeating task isn't finished: it moves to its next date with its subtasks cleared, and the run
 * that was just done is reported so it can be counted.
 */
export function completeTask(task: Task, done: boolean, time = now()): { task: Task; repeated: boolean } {
  if (done && task.repeat && task.due !== undefined) {
    let due = nextDue(task.due, task.repeat)
    // A task due long ago catches up to the future rather than firing over and over.
    for (let i = 0; i < 500 && due <= time; i++) due = nextDue(due, task.repeat)
    return { repeated: true, task: { ...task, due, done: false, completedAt: undefined, subtasks: task.subtasks.map((s) => ({ ...s, done: false })), updatedAt: time } }
  }
  return { repeated: false, task: { ...task, done, completedAt: done ? time : undefined, updatedAt: time } }
}

// ---------------------------------------------------------------- views

export type TaskView = 'all' | 'today' | 'upcoming' | 'overdue' | 'completed' | 'flagged' | 'reminders'

export interface TaskFilter {
  view?: TaskView
  listId?: string
  query?: string
  sort?: 'manual' | 'due' | 'priority' | 'created' | 'title'
}

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2, none: 3 }

export function filterTasks(tasks: Task[], filter: TaskFilter = {}, time = now()): Task[] {
  const view = filter.view ?? 'all'
  const query = filter.query?.trim().toLowerCase()
  return tasks
    .filter((t) => !filter.listId || t.listId === filter.listId)
    .filter((t) => {
      if (view === 'completed') return t.done
      if (t.done) return false
      if (view === 'today') return t.due !== undefined && (isDueToday(t, time) || isOverdue(t, time))
      if (view === 'upcoming') return t.due !== undefined && startOfDay(t.due) > startOfDay(time)
      if (view === 'overdue') return isOverdue(t, time)
      if (view === 'flagged') return t.priority === 'high'
      return true
    })
    .filter((t) => !query || `${t.title} ${t.notes} ${t.subtasks.map((s) => s.title).join(' ')}`.toLowerCase().includes(query))
    .sort((a, b) => {
      switch (filter.sort ?? 'manual') {
        case 'due':
          return (a.due ?? Infinity) - (b.due ?? Infinity) || a.order - b.order
        case 'priority':
          return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.due ?? Infinity) - (b.due ?? Infinity)
        case 'created':
          return b.createdAt - a.createdAt
        case 'title':
          return a.title.localeCompare(b.title)
        default:
          return a.order - b.order || a.createdAt - b.createdAt
      }
    })
}

export interface TaskCounts {
  total: number
  open: number
  done: number
  today: number
  overdue: number
  upcoming: number
  flagged: number
  byList: Record<string, number>
}

export function taskCounts(tasks: Task[], time = now()): TaskCounts {
  const counts: TaskCounts = { total: tasks.length, open: 0, done: 0, today: 0, overdue: 0, upcoming: 0, flagged: 0, byList: {} }
  for (const task of tasks) {
    if (task.done) {
      counts.done++
      continue
    }
    counts.open++
    counts.byList[task.listId] = (counts.byList[task.listId] ?? 0) + 1
    if (isOverdue(task, time)) counts.overdue++
    if (task.due !== undefined && (isDueToday(task, time) || isOverdue(task, time))) counts.today++
    else if (task.due !== undefined) counts.upcoming++
    if (task.priority === 'high') counts.flagged++
  }
  return counts
}

/**
 * A task typed in one line: "Pay rent tomorrow 9am !high #bills" sets the date, time, priority and list. Everything
 * understood is removed from the title, and what isn't understood is left alone.
 */
export function parseTaskInput(text: string, lists: TaskList[] = [], time = now()): Partial<Task> & { title: string } {
  let rest = ` ${text} `
  const take = (pattern: RegExp): RegExpMatchArray | null => {
    const m = rest.match(pattern)
    if (m) rest = rest.replace(m[0], ' ')
    return m
  }
  const priorityMatch = take(/\s![ !]*(high|medium|low|h|m|l)\b/i)
  const listMatch = take(/\s#([\p{L}\p{N}_-]+)/u)
  const timeMatch = take(/\s(?:at\s)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) ?? take(/\s(?:at\s)?(\d{1,2}):(\d{2})\b/)
  const dayMatch = take(/\s(today|tomorrow|tonight|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)
  const dateMatch = take(/\s(\d{4})-(\d{2})-(\d{2})\b/)

  const patch: Partial<Task> & { title: string } = { title: rest.replace(/\s+/g, ' ').trim().slice(0, 300) }
  if (priorityMatch) patch.priority = ({ h: 'high', m: 'medium', l: 'low' } as Record<string, TaskPriority>)[priorityMatch[1][0].toLowerCase()] ?? 'none'
  if (listMatch) {
    const name = listMatch[1].toLowerCase()
    const list = lists.find((l) => l.name.toLowerCase().replace(/\s+/g, '-') === name || l.id === name)
    if (list) patch.listId = list.id
    else patch.title = `${patch.title} #${listMatch[1]}`.trim()
  }

  let due: Date | null = null
  if (dateMatch) due = new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]))
  else if (dayMatch) {
    const word = dayMatch[1].toLowerCase()
    due = new Date(startOfDay(time))
    if (word === 'tomorrow') due.setDate(due.getDate() + 1)
    else if (word === 'next week') due.setDate(due.getDate() + 7)
    else if (!['today', 'tonight'].includes(word)) {
      const wanted = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(word)
      due.setDate(due.getDate() + ((wanted - due.getDay() + 7) % 7 || 7))
    }
  }
  if (timeMatch) {
    due ??= new Date(startOfDay(time))
    let hours = Number(timeMatch[1]) % 12
    const meridiem = timeMatch[3]?.toLowerCase()
    if (meridiem === 'pm' || (!meridiem && Number(timeMatch[1]) >= 13)) hours = Number(timeMatch[1]) % 12 || 12
    if (meridiem === 'pm') hours = (Number(timeMatch[1]) % 12) + 12
    if (!meridiem) hours = Number(timeMatch[1])
    due.setHours(hours, Number(timeMatch[2] ?? 0), 0, 0)
    patch.hasTime = true
  } else if (dayMatch?.[1].toLowerCase() === 'tonight' && due) {
    due.setHours(20, 0, 0, 0)
    patch.hasTime = true
  }
  if (due) patch.due = due.getTime()
  return patch
}

/** A task made from a page, keeping the link. */
export const taskFromPage = (page: { url: string; title: string }, listId = INBOX_LIST_ID): Task =>
  newTask({ listId, title: page.title.slice(0, 300) || page.url, link: { url: page.url, title: page.title } })
