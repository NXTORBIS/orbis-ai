import { fetchFavicon } from '../main/favicon.ts'
import type { Handler } from './server.ts'

/**
 * The icon a site shows for itself, for the results page.
 *
 * A page of results is mostly sites nobody here has been to, and the browser's own favicon store only knows the ones that
 * have been visited, so asking it leaves most results wearing the same blank globe. An icon for an unvisited site has to be
 * asked for, and asking each site for its own is the way that tells nobody anything they did not already know: the request
 * goes to that site and nowhere else, so no single party is handed the whole page of results. (The other way round — one
 * icon service for every host — would hand exactly that to whoever runs it.)
 *
 * Icons are kept by host, so a host is asked once and then not again, and a page of ten results is one call rather than ten.
 */

export interface FaviconDeps {
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>
  now?: () => number
}

/** Long enough that a host is asked once and rarely again, short enough that a site that changes its logo is not stuck with the old one. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000
/** The oldest is dropped first, so browsing for a long time cannot grow this without end. */
const MAX_HOSTS = 400
/** A results page asks about every host at once; a few at a time keeps that from becoming a burst of connections. */
const AT_ONCE = 4
/** More than a page of results could sensibly hold. */
const MAX_ASKED = 30
const TIMEOUT_MS = 6000

export function createFaviconHandlers(deps: FaviconDeps): Record<string, Handler> {
  const now = deps.now ?? Date.now
  const kept = new Map<string, { icon: string | null; at: number }>()

  const hostOf = (url: unknown): string | null => {
    if (typeof url !== 'string') return null
    try {
      const parsed = new URL(url)
      return /^https?:$/.test(parsed.protocol) ? parsed.host.toLowerCase() : null
    } catch {
      return null
    }
  }

  const iconFor = async (host: string): Promise<string | null> => {
    const held = kept.get(host)
    if (held && now() - held.at < KEEP_MS) return held.icon
    // A site that cannot be reached, or has no icon, is remembered as having none: it is not asked again on every search.
    const icon = await fetchFavicon(`https://${host}`, deps.fetchFn, TIMEOUT_MS).catch(() => null)
    if (kept.size >= MAX_HOSTS) {
      const oldest = kept.keys().next()
      if (!oldest.done) kept.delete(oldest.value)
    }
    kept.set(host, { icon, at: now() })
    return icon
  }

  return {
    /** The icon for each host among these addresses, as a data URL, or null for a host that has none. */
    'favicon:get': async ([urls]) => {
      const asked = Array.isArray(urls) ? urls : []
      const hosts = [...new Set(asked.map(hostOf).filter((host): host is string => Boolean(host)))].slice(0, MAX_ASKED)
      const icons: Record<string, string | null> = {}
      for (let i = 0; i < hosts.length; i += AT_ONCE) {
        await Promise.all(
          hosts.slice(i, i + AT_ONCE).map(async (host) => {
            icons[host] = await iconFor(host)
          })
        )
      }
      return { icons }
    }
  }
}
