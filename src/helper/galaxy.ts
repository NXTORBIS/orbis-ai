import { GALAXY_TYPES } from '../shared/galaxy.ts'
import type { GalaxyGraph, GalaxyNodeType, GalaxyView } from '../shared/galaxy'
import { HelperError } from './server.ts'
import type { Handler } from './server.ts'

/**
 * Galaxy for the panel: the map Electron Orbis draws, from the same GalaxyService (built from the same stores). It can also
 * make and remove the person's own links and prepare the question about a selection, through the same service methods as the
 * Orbis window's IPC handlers.
 */

/** What the panel uses of the GalaxyService. The real one satisfies this as it is. */
export interface GalaxyDeps {
  view(view: GalaxyView): Promise<GalaxyGraph>
  describe(id: string): Promise<unknown>
  /** Rebuild on the next look, as the Orbis window does when it opens the map. */
  refresh?(): void
  link?(from: string, to: string, note?: string): Promise<unknown>
  unlink?(id: string): boolean
  askAbout?(ids: string[], question: string): Promise<string>
}

const idArg = (x: unknown, max: number, what: string): string => {
  if (typeof x !== 'string' || !x || x.length > max) throw new HelperError('bad-request', `Expected ${what}.`)
  return x
}

/** The same rules the Orbis window's own request goes through: known types, bounded text and limits. */
export function readView(raw: unknown): GalaxyView {
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) throw new HelperError('bad-request', 'The view must be an object.')
  const v = (raw ?? {}) as Record<string, unknown>
  const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)
  return {
    ...(Array.isArray(v.types) ? { types: v.types.filter((t): t is GalaxyNodeType => GALAXY_TYPES.includes(t as GalaxyNodeType)) } : {}),
    ...(typeof v.query === 'string' ? { query: v.query.slice(0, 200) } : {}),
    ...(typeof v.focus === 'string' ? { focus: v.focus.slice(0, 2100) } : {}),
    ...(num(v.depth) !== undefined ? { depth: num(v.depth) } : {}),
    ...(num(v.from) !== undefined ? { from: num(v.from) } : {}),
    ...(num(v.to) !== undefined ? { to: num(v.to) } : {}),
    limit: num(v.limit) !== undefined ? Math.max(10, Math.min(1500, num(v.limit)!)) : 400
  }
}

export function createGalaxyHandlers(getDeps: () => GalaxyDeps | null | undefined): Record<string, Handler> {
  const deps = (): GalaxyDeps => {
    const d = getDeps()
    if (!d) throw new HelperError('unavailable', 'Galaxy is not ready yet. Try again in a moment.')
    return d
  }
  return {
    'galaxy:view': async (a) => {
      const d = deps()
      const view = readView(a[0])
      d.refresh?.()
      return d.view(view)
    },
    'galaxy:describe': async (a) => {
      if (typeof a[0] !== 'string' || !a[0] || a[0].length > 2100) throw new HelperError('bad-request', 'Expected a node id.')
      return deps().describe(a[0])
    },
    'galaxy:link': async (a) => {
      const d = deps()
      if (!d.link) throw new HelperError('unavailable', 'Linking is not available.')
      if (a[2] !== undefined && a[2] !== null && typeof a[2] !== 'string') throw new HelperError('bad-request', 'The note must be text.')
      const note = typeof a[2] === 'string' ? a[2].slice(0, 200) || undefined : undefined
      return d.link(idArg(a[0], 2100, 'a node id'), idArg(a[1], 2100, 'a node id'), note)
    },
    'galaxy:unlink': async (a) => {
      const d = deps()
      if (!d.unlink) throw new HelperError('unavailable', 'Unlinking is not available.')
      return d.unlink(idArg(a[0], 80, 'a link id'))
    },
    'galaxy:ask': async (a) => {
      const d = deps()
      if (!d.askAbout) throw new HelperError('unavailable', 'Asking Orion is not available.')
      if (!Array.isArray(a[0]) || a[0].length > 40 || a[0].some((i) => typeof i !== 'string' || !i || i.length > 2100)) throw new HelperError('bad-request', 'Expected up to 40 node ids.')
      if (a[1] !== undefined && typeof a[1] !== 'string') throw new HelperError('bad-request', 'The question must be text.')
      return d.askAbout(a[0] as string[], ((a[1] as string | undefined) ?? '').slice(0, 1000))
    }
  }
}
