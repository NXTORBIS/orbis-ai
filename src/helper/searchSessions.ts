import { SearchSessionStore } from '../main/knowledge/searchSessions.ts'
import { suggestFollowups } from '../main/suggest.ts'
import type { Handler } from './server.ts'

/**
 * Orion Search sessions for the results page: the very store the Orbis window saves its research in (same database file, same
 * checks on what is stored), so research started in either place can be reopened in the other. Also the follow-up questions
 * shown under an answer, made by the same code the Orbis window uses.
 */

export interface SearchSessionsDeps {
  /** The app's own store when the helper runs inside Orbis; otherwise the helper opens the same database itself. */
  store?: () => Pick<SearchSessionStore, 'save' | 'list' | 'get' | 'find' | 'remove' | 'clear' | 'withSources'> | null | undefined
  userData?: string
  profileId?: string
  apiKeys: string[]
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>
}

export function createSearchSessionHandlers(deps: SearchSessionsDeps): Record<string, Handler> {
  let own: SearchSessionStore | null = null
  const store = () => {
    const shared = deps.store?.()
    if (shared) return shared
    if (!deps.userData) return null
    own ??= new SearchSessionStore(deps.userData, deps.profileId)
    return own
  }
  const need = () => {
    const s = store()
    if (!s) throw Object.assign(new Error('Saved research is not available.'), { code: 'not-ready' })
    return s
  }
  return {
    'search-sessions:save': ([session]) => need().save(session),
    'search-sessions:list': ([query]) => need().list(typeof query === 'string' ? query.slice(0, 200) : undefined),
    'search-sessions:get': ([id]) => need().get(String(id).slice(0, 80)),
    'search-sessions:find': ([about]) => need().find(String(about).slice(0, 200)),
    'search-sessions:remove': ([id]) => need().remove(String(id).slice(0, 80)),
    'search-sessions:clear': () => need().clear(),
    'chat:suggest': ([messages]) => {
      const valid = (Array.isArray(messages) ? messages : [])
        .filter((m): m is { role: string; content: string } => !!m && typeof (m as { role?: unknown }).role === 'string' && typeof (m as { content?: unknown }).content === 'string')
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
      return suggestFollowups(valid, deps.apiKeys, (url, init) => deps.fetchFn(url, init))
    }
  }
}
