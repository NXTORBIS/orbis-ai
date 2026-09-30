import { HelperError } from './server.ts'
import type { Handler } from './server.ts'
import type { RecallHit } from '../shared/recall.ts'

/**
 * What the browser may ask about the pages this person has read.
 *
 * The reading index lives in the Orbis window's process, and the browser's panel is where somebody actually looks
 * things up — which is right, because everything in it came from browsing. So these are the channels that panel uses,
 * and deliberately only those.
 *
 * **Nothing here switches the feature on, and nothing here empties it.** Both of those are decisions made in Settings,
 * with the wording about what is kept and what it costs in front of the person. A page that could switch on a recorder
 * of everything you read would be the objectionable version of this feature wearing the same name, and "forget
 * everything" is not something to put one mis-click away from a search box.
 *
 * What it can do is the opposite of recording: forget one page, or forget a whole site. Somebody who has just found a
 * page they wish were not there should be able to remove it from where they found it, without going anywhere.
 */

export interface RecallHelperDeps {
  /** The app's own index. Absent when the browser is running without the Orbis window, and the panel then says so. */
  store: {
    settings(): { enabled: boolean }
    search(query: string, options?: { limit?: number; host?: string }): RecallHit[]
    recent(limit?: number, host?: string): RecallHit[]
    forget(id: string): boolean
    forgetHost(host: string, alsoBlock?: boolean): number
    stats(): { pages: number; chars: number; oldestAt: number | null; newestAt: number | null; topHosts: { host: string; pages: number }[] }
  }
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')
const count = (value: unknown, or: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : or

export function createRecallHandlers(getDeps: () => RecallHelperDeps | null | undefined): Record<string, Handler> {
  const need = (): RecallHelperDeps['store'] => {
    const deps = getDeps()
    if (!deps?.store) {
      // The truth, rather than an empty list that reads as "you have read nothing".
      throw new HelperError('unavailable', 'Orbis is not running, so your reading history cannot be read.')
    }
    return deps.store
  }

  const guarded =
    (run: (a: unknown[]) => unknown): Handler =>
    async (a) => {
      try {
        return await run(a)
      } catch (err) {
        if (err instanceof HelperError) throw err
        // Never the underlying message: it could carry a path, and a path carries a person's name.
        throw new HelperError('failed', 'That could not be read.')
      }
    }

  return {
    /** Whether there is anything to show, so the panel can say "off" rather than "empty". */
    'recall:state': guarded(() => {
      const store = need()
      const stats = store.stats()
      return { enabled: store.settings().enabled, pages: stats.pages, topHosts: stats.topHosts.slice(0, 8) }
    }),

    'recall:search': guarded((a) => {
      const store = need()
      const query = text(a[0], 400)
      const options = a[1] && typeof a[1] === 'object' ? (a[1] as Record<string, unknown>) : {}
      return {
        hits: store.search(query, {
          limit: Math.max(1, Math.min(count(options.limit, 30), 100)),
          host: options.host ? text(options.host, 253) : undefined
        })
      }
    }),

    'recall:recent': guarded((a) => ({
      hits: need().recent(Math.max(1, Math.min(count(a[0], 40), 200)), a[1] ? text(a[1], 253) : undefined)
    })),

    /** Forgets one page. The smallest thing somebody can want removed, reachable from where they found it. */
    'recall:forget': guarded((a) => ({ forgotten: need().forget(text(a[0], 80)) })),

    /**
     * Forgets a whole site, and stops it being recorded again.
     *
     * The two together, because deleting a site while leaving it free to come straight back would be a button that
     * appears not to work. This is the one write here that changes a setting, and it only ever adds a site to the
     * do-not-record list — it can never take one off.
     */
    'recall:forget-site': guarded((a) => ({ forgotten: need().forgetHost(text(a[0], 253), true) }))
  }
}
