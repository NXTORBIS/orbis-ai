import { readFile } from 'node:fs/promises'
import { join, resolve, sep, extname } from 'node:path'
import { looksSecret } from '../shared/clipboardHistory.ts'
import type { ClipItem, ClipKind } from '../shared/clipboardHistory.ts'
import type { PanelControl } from './browserControl.ts'
import { HelperError } from './server.ts'
import type { Handler } from './server.ts'

/**
 * The stores behind the sidebar rows that keep things: saved pages and screenshots (the browsing library), the clipboard history,
 * reminders (tasks with a time), whiteboards, workspaces, and the sources of saved research. Each is the app's own store, lent by the
 * app at call time; when one is not there the channel says so ("not available") instead of answering with anything invented.
 * Every argument is checked. Nothing here logs what is stored, and clipboard text that looks like a password or key is never sent
 * unmasked except by the explicit `clipboard:reveal` call for that one entry.
 */

export interface PanelStores {
  library?: {
    directory(): string
    savedPages(): { url: string; title: string; path: string; savedAt: number }[]
    forgetSavedPage(path: string): boolean
    screenshots(): { id: string; url: string; title: string; path: string; at: number; width: number; height: number }[]
    screenshot(id: string): { id: string; path: string } | undefined
    removeScreenshot(id: string): { id: string; path: string } | undefined
  }
  /** Removes a picture's file (only ever called for a file the library named). */
  removeFile?: (path: string) => Promise<void>
  /** Opens a saved page's file with the system (only ever called for a path in the saved pages list). */
  openFile?: (path: string) => Promise<string | void>
  clipboard?: {
    search(query: string, kind?: ClipKind | 'all' | 'pinned'): Promise<ClipItem[]>
    all(): Promise<ClipItem[]>
    copyToClipboard(id: string): Promise<ClipItem>
    setPinned(id: string, pinned: boolean): Promise<ClipItem | null>
    remove(id: string): Promise<boolean>
    clear(includePinned?: boolean): Promise<number>
    isPaused(): boolean
    lastSkipped(): string | null
  }
  tasks?: {
    search(filter?: { view?: string; query?: string }): Promise<{ id: string; title: string; due?: number; hasTime: boolean; done: boolean; listId: string }[]>
    create(patch: { title: string; due?: number; hasTime?: boolean }): Promise<{ id: string }>
    complete(id: string, done: boolean): Promise<unknown>
    remove(id: string): Promise<boolean>
  }
  whiteboard?: {
    list(): Promise<{ id: string; name: string; count: number; updatedAt: number }[]>
    get(id: string): Promise<{ id: string; name: string; elements: { kind: string; text?: string }[]; updatedAt: number } | null>
    create(patch?: { name?: string }): Promise<{ id: string; name: string }>
    rename(id: string, name: string): Promise<unknown>
    remove(id: string): Promise<boolean>
    add(id: string, elements: unknown[]): Promise<unknown>
  }
  workspaces?: {
    list(): Promise<{ id: string; name: string; color: string; lastOpenedAt?: number; summary?: unknown; tabs: { url: string; title: string; pinned: boolean; group?: string; active?: boolean; muted?: boolean }[]; groups: { name: string; color: string; collapsed: boolean }[] }[]>
    get(id: string): Promise<{ id: string; tabs: { url: string; title: string; pinned: boolean; group?: string; active?: boolean; muted?: boolean }[]; groups: { name: string; color: string; collapsed: boolean }[] } | null>
    current(): string | null
    setCurrent(id: string | null): void
    saveCurrent(name: string, state: { tabs: { url: string; title: string; pinned?: boolean; muted?: boolean; active?: boolean; groupId?: string | null }[]; groups?: { id: string; name: string; color: string; collapsed?: boolean }[] } | null): Promise<{ id: string; name: string }>
    rename(id: string, name: string): Promise<unknown>
    remove(id: string): Promise<boolean>
    markOpened(id: string): Promise<unknown>
  }
  /** Saved research, for the Sources row (the Research row uses the search-sessions channels). */
  research?: { withSources(limit?: number): { id: string; title: string; updatedAt: number; sourceList: { url: string; title: string }[] }[] }
  control?: PanelControl | null
}

const bad = (message: string): never => {
  throw new HelperError('bad-request', message)
}
const unavailable = (what: string): never => {
  throw new HelperError('unavailable', `${what} is not available in this build.`)
}
const id = (value: unknown, what = 'The entry'): string => (typeof value === 'string' && /^[\w.:-]{1,80}$/.test(value) ? value : bad(`${what} is not valid.`))
const name = (value: unknown, what = 'The name', max = 80): string => (typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : bad(`${what} is not valid.`))
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const KINDS = new Set(['all', 'pinned', 'text', 'link', 'image', 'color', 'code'])
const MASK = '•'.repeat(8)

/** A clipboard entry as the panel may see it: never the copied content itself, and a masked preview when the text looks secret. */
export function clipRow(item: ClipItem): Record<string, unknown> {
  const masked = item.kind !== 'image' && looksSecret(item.content)
  return {
    id: item.id,
    kind: item.kind,
    preview: masked ? MASK : item.preview,
    masked,
    pinned: item.pinned,
    copiedAt: item.copiedAt,
    times: item.times,
    bytes: item.bytes,
    ...(item.size ? { size: item.size } : {}),
    ...(item.source?.url ? { source: { url: item.source.url, ...(item.source.title ? { title: item.source.title } : {}) } } : {})
  }
}

export function createPanelStoreHandlers(get: () => PanelStores | null | undefined): Record<string, Handler> {
  const stores = (): PanelStores => get() ?? {}
  const library = () => stores().library ?? unavailable('The library of saved pages and pictures')
  const clip = () => stores().clipboard ?? unavailable('Clipboard history')
  const tasks = () => stores().tasks ?? unavailable('Reminders')
  const boards = () => stores().whiteboard ?? unavailable('Whiteboard')
  const spaces = () => stores().workspaces ?? unavailable('Workspaces')
  const control = () => stores().control ?? unavailable('The browser')
  const run = async (capability: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    const result = await control().execute({ capability, params, source: 'user' }, { confirm: async () => true })
    if (!result.ok) throw new HelperError('failed', result.error?.message ?? 'The browser could not do that.')
    return result.data
  }
  /** A picture is read only when it is inside the library folder and looks like a small PNG or JPEG. */
  const imageOf = async (path: string, root: string): Promise<string | null> => {
    const full = resolve(path)
    const base = resolve(root) + sep
    const ext = extname(full).toLowerCase()
    if (!full.startsWith(base) || !['.png', '.jpg', '.jpeg'].includes(ext)) return null
    try {
      const bytes = await readFile(full)
      if (bytes.length > MAX_IMAGE_BYTES) return null
      return `data:image/${ext === '.png' ? 'png' : 'jpeg'};base64,${bytes.toString('base64')}`
    } catch {
      return null
    }
  }

  return {
    // ---------------------------------------------------------------- saved pages and screenshots
    'library:saved-pages': () => library().savedPages().slice(0, 500),
    'library:saved-page-forget': ([path]) => {
      const p = typeof path === 'string' && path.length <= 1000 ? path : bad('The page is not valid.')
      return library().forgetSavedPage(p)
    },
    'library:saved-page-open': async ([path]) => {
      const p = typeof path === 'string' && path.length <= 1000 ? path : bad('The page is not valid.')
      // Only a path the library itself lists is ever opened.
      if (!library().savedPages().some((page) => page.path === p)) throw new HelperError('not-found', 'That page is not in the list.')
      // Only a saved web page is ever handed to the system, never a program or script that a damaged list might name.
      if (!/.(html?|xhtml|mhtml?|pdf)$/i.test(p)) throw new HelperError('failed', 'That file is not a saved web page.')
      const open = stores().openFile ?? unavailable('Opening a saved file')
      const problem = await open(p)
      if (typeof problem === 'string' && problem) throw new HelperError('failed', 'The saved file could not be opened.')
      return true
    },
    'library:screenshots': () => library().screenshots().slice(0, 500).map(({ path: _path, ...shot }) => shot),
    'library:screenshot-image': async ([shotId]) => {
      const lib = library()
      const shot = lib.screenshots().find((s) => s.id === id(shotId, 'The picture'))
      return shot ? imageOf(shot.path, join(lib.directory(), 'screenshots')) : null
    },
    'library:screenshot-remove': async ([shotId]) => {
      const lib = library()
      const going = lib.removeScreenshot(id(shotId, 'The picture'))
      // The picture was taken and kept by Orbis, so removing it removes its file too, but only from the library's own folder.
      if (going && stores().removeFile && resolve(going.path).startsWith(resolve(join(lib.directory(), 'screenshots')) + sep)) await stores().removeFile!(going.path).catch(() => undefined)
      return Boolean(going)
    },

    // ---------------------------------------------------------------- clipboard
    'clipboard:list': async ([query, kind]) => {
      const q = query === undefined || query === null ? '' : typeof query === 'string' && query.length <= 200 ? query : bad('The search is not valid.')
      const k = kind === undefined || kind === null ? undefined : typeof kind === 'string' && KINDS.has(kind) ? (kind as ClipKind | 'all' | 'pinned') : bad('The kind is not valid.')
      const c = clip()
      const items = await c.search(q, k)
      return { paused: c.isPaused(), lastSkipped: c.lastSkipped(), items: items.slice(0, 300).map(clipRow) }
    },
    /** The one place a masked entry's text leaves the store: asked for by id, for that entry only. */
    'clipboard:reveal': async ([entry]) => {
      const wanted = id(entry)
      const item = (await clip().all()).find((c) => c.id === wanted)
      if (!item || item.kind === 'image') throw new HelperError('not-found', 'That entry is no longer in the history.')
      return { id: item.id, text: item.content.slice(0, 2000) }
    },
    'clipboard:image': async ([entry]) => {
      const wanted = id(entry)
      const item = (await clip().all()).find((c) => c.id === wanted)
      return item && item.kind === 'image' && item.content.startsWith('data:image/') && item.content.length < 8_000_000 ? item.content : null
    },
    'clipboard:copy': async ([entry]) => {
      const item = await clip().copyToClipboard(id(entry))
      return clipRow(item)
    },
    'clipboard:pin': async ([entry, pinned]) => {
      if (typeof pinned !== 'boolean') bad('Pinned must be true or false.')
      const item = await clip().setPinned(id(entry), pinned as boolean)
      return item ? clipRow(item) : null
    },
    'clipboard:remove': ([entry]) => clip().remove(id(entry)),
    'clipboard:clear': async ([includePinned]) => ({ removed: await clip().clear(includePinned === true) }),

    // ---------------------------------------------------------------- reminders (tasks that have a time)
    'reminders:list': async () => {
      const all = await tasks().search({ view: 'all' })
      const done = await tasks().search({ view: 'completed' })
      const row = (t: { id: string; title: string; due?: number; hasTime: boolean; done: boolean }) => ({ id: t.id, title: t.title, due: t.due, hasTime: t.hasTime, done: t.done })
      return [...all.filter((t) => t.due !== undefined), ...done.filter((t) => t.due !== undefined)]
        .map(row)
        .sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? 0) - (b.due ?? 0))
        .slice(0, 300)
    },
    'reminders:add': async ([title, due, hasTime]) => {
      const t = name(title, 'The reminder', 500)
      if (typeof due !== 'number' || !Number.isFinite(due) || due < 0 || due > 8.64e15) bad('The time is not valid.')
      const made = await tasks().create({ title: t, due: due as number, hasTime: hasTime === true })
      return { id: made.id }
    },
    'reminders:done': async ([task, done]) => {
      if (typeof done !== 'boolean') bad('Done must be true or false.')
      await tasks().complete(id(task, 'The reminder'), done as boolean)
      return true
    },
    'reminders:remove': ([task]) => tasks().remove(id(task, 'The reminder')),

    // ---------------------------------------------------------------- whiteboards
    'whiteboard:list': async () => (await boards().list()).slice(0, 300).map((b) => ({ id: b.id, name: b.name, count: b.count, updatedAt: b.updatedAt })),
    /** What is on a board, as text: notes and text in full (clipped), everything else as a count. */
    'whiteboard:get': async ([board]) => {
      const found = await boards().get(id(board, 'The board'))
      if (!found) throw new HelperError('not-found', 'That board no longer exists.')
      const items = found.elements.filter((e) => e.kind === 'note' || e.kind === 'text').slice(0, 200).map((e) => ({ kind: e.kind, text: String(e.text ?? '').slice(0, 500) }))
      return { id: found.id, name: found.name, total: found.elements.length, items, updatedAt: found.updatedAt }
    },
    'whiteboard:create': async ([boardName]) => {
      const made = await boards().create({ name: boardName === undefined ? 'New board' : name(boardName, 'The name', 80) })
      return { id: made.id, name: made.name }
    },
    'whiteboard:rename': async ([board, boardName]) => {
      await boards().rename(id(board, 'The board'), name(boardName, 'The name', 80))
      return true
    },
    'whiteboard:remove': ([board]) => boards().remove(id(board, 'The board')),
    /** Adds the page in front, as a note with its title and address. */
    'whiteboard:add-page': async ([board]) => {
      const wanted = id(board, 'The board')
      const tabs = (await run('tabs.list')) as { active?: boolean; url?: string; title?: string }[]
      const tab = Array.isArray(tabs) ? tabs.find((t) => t.active) : undefined
      if (!tab || typeof tab.url !== 'string' || !/^https?:\/\//i.test(tab.url)) throw new HelperError('failed', 'There is no web page in front to add.')
      const text = `${String(tab.title ?? '').slice(0, 200)}\n${tab.url.slice(0, 1000)}`.trim()
      await boards().add(wanted, [{ kind: 'note', at: { x: 40, y: 40 }, text, width: 260, height: 120 }])
      return true
    },
    /**
     * Adds a piece of text somebody selected on a page, as a note, with where it came from underneath it.
     *
     * Separate from add-page because the two are different things: that one adds the page, this one adds the words.
     * The source line is part of the note rather than hidden metadata, so a board full of quotes still says where
     * each of them was read -- months later, that line is usually the point.
     */
    'whiteboard:add-text': async ([board, words, from]) => {
      const wanted = id(board, 'The board')
      const body = name(words, 'The text', 4000)
      const source = from === undefined || from === null ? '' : name(from, 'The source', 300)
      const whole = source === '' ? body : `${body}\n\n— ${source}`
      await boards().add(wanted, [{ kind: 'note', at: { x: 40, y: 40 }, text: whole, width: 300, height: 180 }])
      return true
    },

    // ---------------------------------------------------------------- workspaces
    'workspaces:list': async () => {
      const s = spaces()
      const current = s.current()
      return (await s.list()).slice(0, 200).map((w) => ({ id: w.id, name: w.name, color: w.color, tabs: w.tabs.length, groups: w.groups.length, lastOpenedAt: w.lastOpenedAt, current: w.id === current }))
    },
    /** Opens it through the control layer (browser.openWorkspace); with replace, the pages that are open and not part of it are closed first. */
    'workspaces:open': async ([workspace, replace]) => {
      const s = spaces()
      const found = await s.get(id(workspace, 'The workspace'))
      if (!found) throw new HelperError('not-found', 'That workspace no longer exists.')
      if (!found.tabs.length) throw new HelperError('failed', 'That workspace has no pages in it.')
      const data = await run('browser.openWorkspace', { tabs: found.tabs, groups: found.groups, replace: replace === true })
      s.setCurrent(found.id)
      await s.markOpened(found.id)
      return data
    },
    /** Saves the pages that are open now as a new workspace. */
    'workspaces:create': async ([workspaceName]) => {
      const s = spaces()
      const title = name(workspaceName, 'The name', 60)
      const tabs = (await run('tabs.list')) as { url: string; title: string; pinned?: boolean; muted?: boolean; active?: boolean; groupId?: number | string }[]
      const groups = (await run('groups.list')) as { id: string; name: string; color: string; collapsed?: boolean }[]
      const web = (Array.isArray(tabs) ? tabs : []).filter((t) => typeof t.url === 'string' && /^https?:\/\//i.test(t.url))
      if (!web.length) throw new HelperError('failed', 'There are no web pages open to save.')
      const snapshot = {
        tabs: web.map((t) => ({ url: t.url, title: String(t.title ?? ''), pinned: t.pinned === true, muted: t.muted === true, active: t.active === true, groupId: t.groupId !== undefined && Number(t.groupId) >= 0 ? String(t.groupId) : null })),
        groups: Array.isArray(groups) ? groups : []
      }
      const made = await s.saveCurrent(title, snapshot)
      return { id: made.id, name: made.name }
    },
    'workspaces:rename': async ([workspace, workspaceName]) => {
      await spaces().rename(id(workspace, 'The workspace'), name(workspaceName, 'The name', 60))
      return true
    },
    'workspaces:remove': ([workspace]) => spaces().remove(id(workspace, 'The workspace')),

    // ---------------------------------------------------------------- the sources of saved research
    'research:sources': () => {
      const research = stores().research ?? unavailable('Saved research')
      const seen = new Set<string>()
      const out: { url: string; title: string; sessionId: string; sessionTitle: string; updatedAt: number }[] = []
      for (const session of research.withSources(300)) {
        for (const source of session.sourceList) {
          if (seen.has(source.url) || !/^https?:\/\//i.test(source.url)) continue
          seen.add(source.url)
          out.push({ url: source.url, title: source.title, sessionId: session.id, sessionTitle: session.title, updatedAt: session.updatedAt })
          if (out.length >= 400) return out
        }
      }
      return out
    }
  }
}
