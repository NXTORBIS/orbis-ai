import { MemoryFull, MemoryRefused, MemoryStore } from '../main/knowledge/memory.ts'
import { MEMORY_CATEGORIES } from '../shared/memory.ts'
import type { MemoryCategory } from '../shared/memory.ts'
import { HelperError } from './server.ts'
import type { Handler } from './server.ts'

/**
 * Memory for the pages in the browser: the same MemoryStore the Orbis window uses, on the same database file, so what a
 * person asked Orbis to remember is one set of things rather than two that drift apart.
 *
 * Two rules from the store are worth naming here, because this is where a page meets them. Memory belongs to one profile,
 * and the profile is asked for on every call: a page cannot name a profile, and a profile that cannot be named is answered
 * with "not ready" rather than with the first profile's memory. And nothing is written unless one of these channels was
 * called, which only happens when the person asked for it — nothing on this side watches a conversation and keeps what it
 * thinks it heard.
 *
 * Being refused is a real answer the person needs to read: memory switched off, something that looks secret, or memory
 * full. Each comes back with its own code and the store's own words, never as a general failure.
 */

export interface MemoryDeps {
  /** The folder the app keeps its profiles' data in; MemoryStore picks this profile's own folder inside it. */
  userData: string
  /** Which profile is in use, read on every call, so switching profile in Orbis reaches the browser without a restart. */
  profileId: () => string | null | undefined | Promise<string | null | undefined>
  /**
   * The application's own memory, when it is running.
   *
   * Lent rather than opened again, and for a sharper reason than the other stores: this is SQLite, and two
   * connections to one database file is how a database gets locked at the worst moment -- the comment beside the
   * reading index in handlers.ts says exactly that about exactly this. The header above already says memory is
   * meant to be "one set of things rather than two that drift apart"; a second connection is not how that is got.
   *
   * Absent when the browser is running without the application, which is the one case where opening one here is
   * right.
   */
  store?: () => MemoryStore | null | undefined
}

/** A profile id becomes a folder name under the user data folder, so only the shape profiles.ts gives them is accepted. */
const PROFILE_ID = /^[A-Za-z0-9_-]{1,80}$/
const ENTRY_ID = /^[A-Za-z0-9_-]{1,80}$/
const MAX_QUERY = 200
/**
 * Far longer than a memory may be. The store's own limit is the one the person is told about; this only keeps a page from
 * handing megabytes of text to the checks that decide whether it may be kept.
 */
const MAX_TEXT = 10_000

const bad = (why: string): never => {
  throw new HelperError('bad-request', why)
}

function options(raw: unknown, what: string): Record<string, unknown> {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) bad(`${what} must be an object.`)
  return raw as Record<string, unknown>
}

function flag(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') bad(`${field} must be true or false.`)
  return value as boolean
}

function entryId(value: unknown): string {
  if (typeof value !== 'string' || !ENTRY_ID.test(value)) bad('That is not a memory id.')
  return value as string
}

function memoryText(value: unknown): string {
  if (typeof value !== 'string') bad('A memory is text.')
  if ((value as string).length > MAX_TEXT) bad('That is far too long to be a memory.')
  return value as string
}

/** An unknown category is refused rather than dropped: a list filtered by something else is not the list that was asked for. */
function category(value: unknown): MemoryCategory {
  if (!MEMORY_CATEGORIES.includes(value as MemoryCategory)) bad('That is not a memory category.')
  return value as MemoryCategory
}

function given(raw: Record<string, unknown>, field: string): boolean {
  return raw[field] !== undefined && raw[field] !== null
}

export function createMemoryHandlers(deps: MemoryDeps): Record<string, Handler> {
  if (!deps.userData) throw new Error('Memory needs the folder the profiles live in.')
  let store: MemoryStore | null = null

  /**
   * The store, on the profile in use now. Getting this wrong would mean one person's memory read or added to under another
   * profile's name, so an unnamed profile stops the call instead of falling back to the first one.
   */
  const open = async (): Promise<MemoryStore> => {
    const profile = await deps.profileId()
    if (typeof profile !== 'string' || !PROFILE_ID.test(profile)) {
      throw new HelperError('not-ready', 'Orbis has not said which profile is in use, so its memory cannot be opened.')
    }
    const lent = deps.store?.()
    if (lent) {
      lent.useProfile(profile)
      return lent
    }
    store ??= new MemoryStore(deps.userData, profile)
    // A no-op while the profile is the same one; on a change it closes the database, so the next read opens the new profile's file.
    store.useProfile(profile)
    return store
  }

  const on = (work: (memory: MemoryStore, args: unknown[]) => unknown): Handler => async (args) => {
    const memory = await open()
    try {
      return work(memory, args)
    } catch (err) {
      // The store words both of these for the person; they are outcomes to show, not failures to hide.
      if (err instanceof MemoryFull) throw new HelperError('memory-full', err.message)
      if (err instanceof MemoryRefused) throw new HelperError('memory-refused', err.message)
      throw err
    }
  }

  return {
    'memory:list': on((memory, [raw]) => {
      const o = options(raw, 'The filter')
      return memory.list({
        ...(given(o, 'query') ? { query: typeof o.query === 'string' && o.query.length <= MAX_QUERY ? o.query : bad(`The search must be text of at most ${MAX_QUERY} characters.`) } : {}),
        ...(given(o, 'includeArchived') ? { includeArchived: flag(o.includeArchived, 'includeArchived') } : {}),
        ...(given(o, 'category') ? { category: category(o.category) } : {})
      })
    }),

    /**
     * Keeps something, because the person asked for it in front of them. The origin is settled here rather than taken from
     * the page: nothing over the wire may claim a memory was approved from a suggestion or brought in from elsewhere.
     */
    'memory:add': on((memory, [text, raw]) => {
      const o = options(raw, 'The options')
      return memory.add(memoryText(text), {
        ...(given(o, 'category') ? { category: category(o.category) } : {}),
        ...(given(o, 'pinned') ? { pinned: flag(o.pinned, 'pinned') } : {}),
        origin: 'settings'
      })
    }),

    'memory:update': on((memory, [id, raw]) => {
      const p = options(raw, 'The change')
      return memory.update(entryId(id), {
        ...(given(p, 'text') ? { text: memoryText(p.text) } : {}),
        ...(given(p, 'category') ? { category: category(p.category) } : {}),
        ...(given(p, 'pinned') ? { pinned: flag(p.pinned, 'pinned') } : {}),
        ...(given(p, 'archived') ? { archived: flag(p.archived, 'archived') } : {})
      })
    }),

    'memory:remove': on((memory, [id]) => memory.remove(entryId(id))),

    /** How many were forgotten, so the page can say what happened rather than assume it worked. */
    'memory:clear': on((memory) => memory.clear()),

    'memory:settings': on((memory) => memory.settings()),

    /** Only the two switches are read; anything else in what arrives is left alone. */
    'memory:set-settings': on((memory, [raw]) => {
      const n = options(raw, 'The settings')
      return memory.setSettings({
        ...(given(n, 'enabled') ? { enabled: flag(n.enabled, 'enabled') } : {}),
        ...(given(n, 'useInChat') ? { useInChat: flag(n.useInChat, 'useInChat') } : {})
      })
    })
  }
}
