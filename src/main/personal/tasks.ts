import type { Task, TaskFilter, TaskList } from '../../shared/tasks.ts'
import { completeTask, filterTasks, INBOX_LIST_ID, newList, newTask, normalizeList, normalizeTask, taskCounts, taskFromPage } from '../../shared/tasks.ts'
import { Collection, personalFile } from './store.ts'
import { DEFAULT_PROFILE_ID } from '../../shared/profiles.ts'

export interface TasksSnapshot {
  lists: TaskList[]
  tasks: Task[]
  counts: ReturnType<typeof taskCounts>
}

/** Task lists and tasks as they are kept and changed. The Inbox list always exists and can't be deleted. */
export class TasksStore {
  private readonly lists: Collection<TaskList>
  private readonly tasks: Collection<Task>

  private readonly userData: string

  constructor(userData: string) {
    this.userData = userData
    this.lists = new Collection<TaskList>(personalFile(userData, DEFAULT_PROFILE_ID, 'task-lists.json'), normalizeList, 200)
    this.tasks = new Collection<Task>(personalFile(userData, DEFAULT_PROFILE_ID, 'tasks.json'), normalizeTask, 20_000)
  }

  /** Moves to another profile's tasks. Each profile keeps its own; the default profile keeps what was there before. */
  async useProfile(profileId: string): Promise<void> {
    await Promise.all([
      this.lists.usePath(personalFile(this.userData, profileId, 'task-lists.json')),
      this.tasks.usePath(personalFile(this.userData, profileId, 'tasks.json')),
    ])
  }

  onChange(listener: () => void): () => void {
    const offLists = this.lists.onChange(listener)
    const offTasks = this.tasks.onChange(listener)
    return () => {
      offLists()
      offTasks()
    }
  }

  /** Every list, with the Inbox first even before anything has been saved. */
  async allLists(): Promise<TaskList[]> {
    const stored = await this.lists.all()
    const inbox = stored.find((l) => l.id === INBOX_LIST_ID) ?? newList({ id: INBOX_LIST_ID, name: 'Inbox', order: -1 })
    return [inbox, ...stored.filter((l) => l.id !== INBOX_LIST_ID)].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
  }

  allTasks(): Promise<Task[]> {
    return this.tasks.all()
  }

  async snapshot(): Promise<TasksSnapshot> {
    const [lists, tasks] = await Promise.all([this.allLists(), this.allTasks()])
    return { lists, tasks, counts: taskCounts(tasks) }
  }

  async search(filter: TaskFilter = {}): Promise<Task[]> {
    return filterTasks(await this.allTasks(), filter)
  }

  saveList(list: TaskList): Promise<TaskList> {
    return this.lists.put(list)
  }

  createList(patch: Partial<TaskList> = {}): Promise<TaskList> {
    return this.lists.put(newList(patch))
  }

  /** Deleting a list moves its tasks to the Inbox rather than deleting them. */
  async removeList(id: string): Promise<boolean> {
    if (id === INBOX_LIST_ID) throw new Error("The Inbox can't be deleted.")
    const removed = await this.lists.remove(id)
    if (removed) await this.tasks.update((tasks) => tasks.map((t) => (t.listId === id ? { ...t, listId: INBOX_LIST_ID, updatedAt: Date.now() } : t)))
    return removed
  }

  async create(patch: Partial<Task> = {}): Promise<Task> {
    const tasks = await this.allTasks()
    const listId = patch.listId ?? INBOX_LIST_ID
    const lowest = Math.min(0, ...tasks.filter((t) => t.listId === listId).map((t) => t.order))
    return this.tasks.put(newTask({ order: lowest - 1, ...patch, listId }))
  }

  get(id: string): Promise<Task | null> {
    return this.tasks.get(id)
  }

  save(task: Task): Promise<Task> {
    return this.tasks.put({ ...task, updatedAt: Date.now() })
  }

  async update(id: string, patch: Partial<Task>): Promise<Task> {
    const current = await this.get(id)
    if (!current) throw new Error('That task no longer exists.')
    return this.save({ ...current, ...patch, id: current.id })
  }

  /** Ticking a task off; a repeating one moves to its next date instead. */
  async complete(id: string, done: boolean): Promise<{ task: Task; repeated: boolean }> {
    const current = await this.get(id)
    if (!current) throw new Error('That task no longer exists.')
    const result = completeTask(current, done)
    return { task: await this.tasks.put(result.task), repeated: result.repeated }
  }

  remove(id: string): Promise<boolean> {
    return this.tasks.remove(id)
  }

  /** Clears finished tasks (in one list, or everywhere) and says how many went. */
  async clearCompleted(listId?: string): Promise<number> {
    const before = await this.allTasks()
    const next = before.filter((t) => !t.done || (listId ? t.listId !== listId : false))
    await this.tasks.replace(next)
    return before.length - next.length
  }

  /** Puts tasks in the order given, within one list. */
  async reorder(listId: string, orderedIds: string[]): Promise<Task[]> {
    return this.tasks.update((tasks) =>
      tasks.map((task) => {
        const index = task.listId === listId ? orderedIds.indexOf(task.id) : -1
        return index >= 0 ? { ...task, order: index, updatedAt: task.updatedAt } : task
      })
    )
  }

  fromPage(page: { url: string; title: string }, listId?: string): Promise<Task> {
    return this.create(taskFromPage(page, listId))
  }

  /** Tasks that are due and not done, for reminders. */
  async due(at = Date.now()): Promise<Task[]> {
    return (await this.allTasks()).filter((t) => !t.done && t.due !== undefined && t.due <= at)
  }

  async flush(): Promise<void> {
    await Promise.all([this.lists.flush(), this.tasks.flush()])
  }
}
