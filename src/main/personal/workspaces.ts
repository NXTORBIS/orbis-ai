import { join } from 'node:path'
import type { Workspace, WorkspaceTab } from '../../shared/workspaces'
import { fromBrowserState, newWorkspace, normalizeWorkspace, summarize } from '../../shared/workspaces'
import { Collection } from './store'

/** What the browser window currently holds, as the control layer reports it. */
export interface BrowserSnapshot {
  tabs: { url: string; title: string; pinned?: boolean; private?: boolean; muted?: boolean; active?: boolean; groupId?: string | null }[]
  groups?: { id: string; name: string; color: string; collapsed?: boolean }[]
}

/**
 * Workspaces as they are kept: named sets of tabs and groups. A workspace that keeps itself up to date is refreshed
 * whenever the window changes, but only while it is the one that is open.
 */
export class WorkspacesStore {
  private readonly workspaces: Collection<Workspace>
  /** The workspace the window is showing, so "update as I browse" knows which one to keep. */
  private currentId: string | null = null
  private saveTimer: NodeJS.Timeout | null = null

  constructor(userData: string) {
    this.workspaces = new Collection<Workspace>(join(userData, 'personal', 'workspaces.json'), normalizeWorkspace, 200)
  }

  onChange(listener: () => void): () => void {
    return this.workspaces.onChange(listener)
  }

  async list(): Promise<(Workspace & { summary: ReturnType<typeof summarize> })[]> {
    return (await this.workspaces.all())
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
      .map((w) => ({ ...w, summary: summarize(w) }))
  }

  get(id: string): Promise<Workspace | null> {
    return this.workspaces.get(id)
  }

  current(): string | null {
    return this.currentId
  }

  setCurrent(id: string | null): void {
    this.currentId = id
  }

  /** Saves what the window holds now as a new workspace. */
  async saveCurrent(name: string, state: BrowserSnapshot | null, patch: Partial<Workspace> = {}): Promise<Workspace> {
    const { tabs, groups } = fromBrowserState(state)
    if (!tabs.length) throw new Error('There are no pages open to save.')
    const all = await this.workspaces.all()
    const saved = await this.workspaces.put(newWorkspace({ name, tabs, groups, order: all.length, ...patch }))
    this.currentId = saved.id
    return saved
  }

  /** Brings a workspace up to date with what the window holds now. */
  async updateFrom(id: string, state: BrowserSnapshot | null): Promise<Workspace> {
    const workspace = await this.get(id)
    if (!workspace) throw new Error('That workspace no longer exists.')
    const { tabs, groups } = fromBrowserState(state)
    if (!tabs.length) throw new Error('There are no pages open to save.')
    return this.workspaces.put({ ...workspace, tabs, groups, updatedAt: Date.now() })
  }

  save(workspace: Workspace): Promise<Workspace> {
    return this.workspaces.put({ ...workspace, updatedAt: Date.now() })
  }

  async rename(id: string, name: string): Promise<Workspace> {
    const workspace = await this.get(id)
    if (!workspace) throw new Error('That workspace no longer exists.')
    return this.save({ ...workspace, name })
  }

  async remove(id: string): Promise<boolean> {
    if (this.currentId === id) this.currentId = null
    return this.workspaces.remove(id)
  }

  async duplicate(id: string): Promise<Workspace> {
    const workspace = await this.get(id)
    if (!workspace) throw new Error('That workspace no longer exists.')
    const all = await this.workspaces.all()
    return this.workspaces.put(newWorkspace({ ...workspace, id: crypto.randomUUID(), name: `${workspace.name} copy`, order: all.length, createdAt: Date.now(), updatedAt: Date.now() }))
  }

  async reorder(ids: string[]): Promise<Workspace[]> {
    return this.workspaces.update((all) => all.map((w) => (ids.includes(w.id) ? { ...w, order: ids.indexOf(w.id) } : w)))
  }

  /** Notes that a workspace has just been opened. */
  async markOpened(id: string): Promise<Workspace | null> {
    const workspace = await this.get(id)
    if (!workspace) return null
    this.currentId = id
    return this.workspaces.put({ ...workspace, lastOpenedAt: Date.now() })
  }

  /**
   * The window changed: a workspace that keeps itself up to date follows along, a moment later so that a burst of tab
   * changes is one save.
   */
  onBrowserState(state: BrowserSnapshot | null): void {
    if (!this.currentId) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void (async () => {
        const id = this.currentId
        if (!id) return
        const workspace = await this.get(id)
        if (!workspace?.autoUpdate) return
        const { tabs, groups } = fromBrowserState(state)
        if (!tabs.length) return
        if (sameTabs(workspace.tabs, tabs)) return
        await this.workspaces.put({ ...workspace, tabs, groups, updatedAt: Date.now() })
      })()
    }, 1500)
    this.saveTimer.unref?.()
  }

  stop(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
  }

  flush(): Promise<void> {
    return this.workspaces.flush()
  }
}

const sameTabs = (a: WorkspaceTab[], b: WorkspaceTab[]): boolean => a.length === b.length && a.every((tab, i) => tab.url === b[i].url && tab.pinned === b[i].pinned && tab.group === b[i].group)
