import type { PanelControl } from '../browserControl.ts'
import type { Perception } from '../../shared/orbTask.ts'

/**
 * Looking at the browser, as it actually is.
 *
 * Every later stage -- understanding the request, resolving "this page", choosing capabilities, verifying what
 * happened -- is only as good as this. So there is no model here and nothing remembered from last time that could
 * have gone stale: perception is a set of reads against the live Browser Control Layer, and a read that fails is
 * reported as missing rather than filled in from what it used to be.
 *
 * It is also the most expensive thing the Orb does, and doing it on every keystroke would make the browser slow. So:
 *
 *   - the capability list is cached, because it changes when Orbis changes rather than when a page does
 *   - the page and tabs are cached only for a moment, long enough to serve one turn without reading twice
 *   - a screenshot is taken only when something actually needs to see, and kept for the turn that asked for it
 *   - anything that changed the browser invalidates the cache, so the next look is a real one
 *
 * The bargain throughout is that staleness is worse than cost. Where the two conflict, this reads again.
 */

/** Long enough that one turn does not read the same thing twice; short enough that nothing acts on a stale page. */
const PAGE_TTL_MS = 1500
/** The registry changes when Orbis gains or loses a capability, which is not something a page can do. */
const CAPABILITY_TTL_MS = 30_000

interface Cached<T> {
  at: number
  value: T
}

export interface Eyes {
  /** Everything, for planning. Reads what it must and serves the rest from cache. */
  look(options?: { text?: boolean; force?: boolean }): Promise<Perception>
  /** A picture of the page, for the questions words cannot answer. Null when there is nothing to capture. */
  see(): Promise<string | null>
  /** Something changed the browser: what was known about it is no longer known. */
  changed(): void
}

/** Runs one capability for reading. Never confirms anything: perception does not change the world. */
async function read(control: PanelControl, capability: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const result = await control.execute({ capability, params, source: 'user' }, { confirm: async () => false })
  return result.ok ? result.data : null
}

export function createEyes(get: () => PanelControl | null | undefined): Eyes {
  let capabilities: Cached<Perception['capabilities']> | null = null
  let world: Cached<{ tabs: Perception['tabs']; page: Perception['page'] }> | null = null
  let shot: Cached<string> | null = null

  const fresh = <T>(c: Cached<T> | null, ttl: number, now: number): T | null => (c && now - c.at < ttl ? c.value : null)

  return {
    changed() {
      // Only what a browser action can invalidate. The capability list is not one of those things.
      world = null
      shot = null
    },

    async look(options = {}) {
      const control = get()
      const now = Date.now()
      if (!control) {
        // No browser. That is a fact about the world, not a reason to describe one that is not there.
        return { at: now, capabilities: [], tabs: [], page: null }
      }

      let caps = options.force ? null : fresh(capabilities, CAPABILITY_TTL_MS, now)
      if (!caps) {
        caps = typeof control.list === 'function' ? control.list({}, 'user') : []
        capabilities = { at: now, value: caps }
      }

      let seen = options.force ? null : fresh(world, PAGE_TTL_MS, now)
      if (!seen) {
        // Tabs and the page are read together: they are one moment, and reading them apart invites a plan built on a
        // page that belonged to a tab which is no longer in front.
        const [tabsRaw, pageRaw] = await Promise.all([
          read(control, 'tabs.list').catch(() => null),
          read(control, 'page.read', { maxChars: options.text ? 12_000 : 1 }).catch(() => null)
        ])
        const tabs = (Array.isArray(tabsRaw) ? tabsRaw : (tabsRaw as { tabs?: unknown[] })?.tabs ?? [])
          .map((t) => {
            const o = (t ?? {}) as Record<string, unknown>
            const id = typeof o.id === 'string' ? o.id : ''
            return id ? { id, title: String(o.title ?? ''), url: String(o.url ?? ''), active: o.active === true } : null
          })
          .filter((t): t is Perception['tabs'][number] => t !== null)

        const p = (pageRaw ?? null) as Record<string, unknown> | null
        const url = typeof p?.url === 'string' ? p.url : ''
        const page: Perception['page'] = url
          ? {
              url,
              title: String(p?.title ?? ''),
              ...(options.text && typeof p?.text === 'string' ? { text: p.text } : {}),
              ...(typeof p?.selection === 'string' && p.selection.trim() ? { selection: p.selection } : {})
            }
          : null
        seen = { tabs, page }
        world = { at: now, value: seen }
      }

      const picture = fresh(shot, PAGE_TTL_MS, now)
      return { at: now, capabilities: caps, tabs: seen.tabs, page: seen.page, ...(picture ? { shot: picture } : {}) }
    },

    async see() {
      const control = get()
      if (!control) return null
      const now = Date.now()
      const kept = fresh(shot, PAGE_TTL_MS, now)
      if (kept) return kept
      const data = await read(control, 'page.screenshot').catch(() => null)
      const o = (data ?? {}) as Record<string, unknown>
      const url = typeof o.dataUrl === 'string' ? o.dataUrl : typeof o.image === 'string' ? o.image : ''
      if (!url.startsWith('data:image/')) return null
      shot = { at: now, value: url }
      return url
    }
  }
}

/** What the browser can do, described for a planner: id, what it is for, and what it takes. Nothing about how it works. */
export function describeCapabilities(capabilities: Perception['capabilities'], limit = 140): string {
  const nl = String.fromCharCode(10)
  return capabilities
    .filter((c) => c.available)
    .slice(0, limit)
    .map((c) => {
      const params = Object.entries(c.params ?? {})
        .map(([name, spec]) => `${name}${spec.required ? '*' : ''}:${spec.type}`)
        .join(', ')
      return `${c.id} — ${c.description || c.name}${params ? ` (${params})` : ''}${c.mutates ? '' : ' [reads only]'}`
    })
    .join(nl)
}

/** The browser as a planner needs to see it: where it is, what is open, what is selected. Facts, briefly. */
export function describeWorld(perception: Perception): string {
  const nl = String.fromCharCode(10)
  const lines: string[] = []
  if (perception.page) {
    lines.push(`The page in front: ${perception.page.title || '(untitled)'} — ${perception.page.url}`)
    if (perception.page.selection?.trim()) lines.push(`Selected on it: ${perception.page.selection.trim().slice(0, 400)}`)
  } else {
    lines.push('There is no web page in front.')
  }
  if (perception.tabs.length) {
    lines.push(`${perception.tabs.length} tab${perception.tabs.length === 1 ? '' : 's'} open:`)
    for (const [i, tab] of perception.tabs.slice(0, 12).entries()) {
      lines.push(`  ${i + 1}. ${tab.active ? '(in front) ' : ''}${tab.title || tab.url} — ${tab.url} [id ${tab.id}]`)
    }
  }
  return lines.join(nl)
}
