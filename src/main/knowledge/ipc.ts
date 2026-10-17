import type { BrowserWindow } from 'electron'

import { plainHandle } from '../ipc/handle.ts'
import type { GalaxyNodeType, GalaxyView } from '../../shared/galaxy.ts'
import type { MemoryCategory } from '../../shared/memory.ts'
import type { GalaxyService } from './galaxyService.ts'
import type { MemoryStore } from './memory.ts'
import type { SearchSessionStore } from './searchSessions.ts'

/**
 * The three things Orbis remembers about what you have done, and the map over them.
 *
 * Three registrars in one file, not one that does everything: memory, saved searches and Galaxy are separate
 * stores with separate rules, and the only thing they share is the folder. They are together here because
 * `index.ts` is not the place for any of them, not because they belong to each other.
 *
 * `recallIpc.ts`, in this same folder, takes its `handle` as an option instead of using the factory directly.
 * That is older: the map that checks every channel is documented could not see a call made through an object, so
 * nine `recall:*` channels went undocumented and unchecked. These three use `plainHandle` and call it `handle`,
 * which the scan does see.
 *
 * **Nothing here can switch memory on.** The settings channels change what is remembered and whether it is used
 * in a conversation, and the switch itself lives in Settings with the wording beside it -- deliberately, because a
 * feature that records what somebody reads should not be able to start doing so on its own.
 */

export interface MemoryIpcOptions {
  getWindow(): BrowserWindow | null
  /** The store, read at the moment of the call: it is built partway through starting up. */
  memory(): MemoryStore
}

const category = (value: unknown): MemoryCategory | undefined =>
  ['about', 'preference', 'project', 'general'].includes(String(value)) ? (value as MemoryCategory) : undefined

export function registerMemoryIpc(o: MemoryIpcOptions): void {
  const handle = plainHandle(o)

  handle('memory:list', (_event, options: unknown) => {
    const v = (options ?? {}) as Record<string, unknown>
    return o.memory().list({
      query: typeof v.query === 'string' ? v.query.slice(0, 200) : undefined,
      includeArchived: v.includeArchived === true,
      category: category(v.category)
    })
  })

  handle('memory:add', (_event, text: unknown, options: unknown) => {
    const v = (options ?? {}) as Record<string, unknown>
    // Where it came from is part of the entry, so "I approved that chip" and "I typed that in Settings" stay apart.
    return o.memory().add(text, { category: category(v.category), pinned: v.pinned === true, origin: v.fromSuggestion === true ? 'suggestion' : 'settings' })
  })

  handle('memory:update', (_event, id: unknown, patch: unknown) => {
    const p = (patch ?? {}) as Record<string, unknown>
    return o.memory().update(String(id), {
      ...(p.text !== undefined ? { text: p.text } : {}),
      ...(category(p.category) ? { category: category(p.category) } : {}),
      ...(typeof p.pinned === 'boolean' ? { pinned: p.pinned } : {}),
      ...(typeof p.archived === 'boolean' ? { archived: p.archived } : {})
    })
  })

  handle('memory:remove', (_event, id: unknown) => o.memory().remove(String(id)))
  handle('memory:clear', () => o.memory().clear())
  handle('memory:settings', () => o.memory().settings())

  handle('memory:set-settings', (_event, next: unknown) => {
    const n = (next ?? {}) as Record<string, unknown>
    return o.memory().setSettings({
      ...(typeof n.enabled === 'boolean' ? { enabled: n.enabled } : {}),
      ...(typeof n.useInChat === 'boolean' ? { useInChat: n.useInChat } : {})
    })
  })
}

export interface SearchSessionsIpcOptions {
  getWindow(): BrowserWindow | null
  sessions(): SearchSessionStore
}

export function registerSearchSessionsIpc(o: SearchSessionsIpcOptions): void {
  const handle = plainHandle(o)

  handle('search-sessions:save', (_event, session: unknown) => o.sessions().save(session))
  handle('search-sessions:list', (_event, query: unknown) => o.sessions().list(typeof query === 'string' ? query.slice(0, 200) : undefined))
  handle('search-sessions:get', (_event, id: unknown) => o.sessions().get(String(id)))
  handle('search-sessions:find', (_event, about: unknown) => o.sessions().find(String(about).slice(0, 200)))
  handle('search-sessions:remove', (_event, id: unknown) => o.sessions().remove(String(id)))
  handle('search-sessions:clear', () => o.sessions().clear())
}

export interface GalaxyIpcOptions {
  getWindow(): BrowserWindow | null
  galaxy(): GalaxyService
}

/** The kinds of thing the map draws. Anything else in a request is dropped rather than refused. */
const TYPES: GalaxyNodeType[] = ['project', 'memory', 'search', 'page', 'site', 'note', 'task', 'skill', 'workflow', 'workspace', 'whiteboard', 'bookmark']

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')

export function registerGalaxyIpc(o: GalaxyIpcOptions): void {
  const handle = plainHandle(o)

  handle('galaxy:view', async (_event, raw: unknown) => {
    const galaxy = o.galaxy()
    // Skills and workflows announce changes to the window rather than to Galaxy, so the map is rebuilt when opened.
    galaxy.refresh()
    const v = (raw ?? {}) as Record<string, unknown>
    const view: GalaxyView = {
      ...(Array.isArray(v.types) ? { types: v.types.filter((t): t is GalaxyNodeType => TYPES.includes(t as GalaxyNodeType)) } : {}),
      ...(typeof v.query === 'string' ? { query: v.query.slice(0, 200) } : {}),
      ...(typeof v.focus === 'string' ? { focus: v.focus.slice(0, 2100) } : {}),
      ...(typeof v.depth === 'number' ? { depth: v.depth } : {}),
      ...(typeof v.from === 'number' ? { from: v.from } : {}),
      ...(typeof v.to === 'number' ? { to: v.to } : {}),
      limit: typeof v.limit === 'number' ? Math.max(10, Math.min(1500, v.limit)) : 400
    }
    return galaxy.view(view)
  })

  handle('galaxy:describe', (_event, id: unknown) => o.galaxy().describe(text(id, 2100)))
  handle('galaxy:link', (_event, from: unknown, to: unknown, note: unknown) =>
    o.galaxy().link(text(from, 2100), text(to, 2100), text(note, 200) || undefined)
  )
  handle('galaxy:unlink', (_event, id: unknown) => o.galaxy().unlink(text(id, 80)))
  handle('galaxy:ask', (_event, ids: unknown, question: unknown) =>
    o.galaxy().askAbout(Array.isArray(ids) ? ids.filter((one): one is string => typeof one === 'string') : [], text(question, 1000))
  )
}
