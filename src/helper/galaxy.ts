import { GALAXY_TYPES } from '../shared/galaxy.ts'
import type { GalaxyGraph, GalaxyNodeType, GalaxyView } from '../shared/galaxy'
import { HelperError } from './server.ts'
import type { Handler } from './server.ts'

/**
 * Galaxy for the panel: the map Electron Orbis draws, from the same GalaxyService (built from the same stores). Read only:
 * making and removing links, and asking Orion about a selection, stay in the Orbis window.
 */

/** What the panel uses of the GalaxyService. The real one satisfies this as it is. */
export interface GalaxyDeps {
  view(view: GalaxyView): Promise<GalaxyGraph>
  describe(id: string): Promise<unknown>
  /** Rebuild on the next look, as the Orbis window does when it opens the map. */
  refresh?(): void
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
    }
  }
}
