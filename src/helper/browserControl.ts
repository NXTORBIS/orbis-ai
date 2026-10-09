import { HelperError } from './server.ts'
import type { Handler } from './server.ts'
import { PendingApprovals } from './browser/host.ts'
import type { CapabilityDescriptor } from '../shared/browserControl.ts'

/** The Browser Control Layer, as far as the panel may use it: run one capability, get { ok, data } or { ok: false, error }. */
export interface PanelControl {
  execute(call: { capability: string; params: Record<string, unknown>; source: 'user' }, options: { confirm: () => Promise<boolean> }): Promise<{ ok: boolean; data?: unknown; error?: { message?: string } }>
  /**
   * Everything the browser can do right now, as the control layer itself reports it.
   *
   * The Orb offers what this returns rather than a menu written by hand, which is what makes it able to reach anything
   * the browser can do: a capability registered anywhere in Orbis appears in the Orb by being registered, not by this
   * file being edited. Each descriptor already carries whether it changes anything, whether it needs asking first, and
   * whether it can run at all -- so the Orb can be honest about all three without deciding any of them itself.
   */
  list?(filter?: { domain?: string; query?: string; availableOnly?: boolean }, source?: 'user'): CapabilityDescriptor[]
}

const bad = (message: string): never => {
  throw new HelperError('bad-request', message)
}
const id = (value: unknown, what: string): string => (typeof value === 'string' && /^[\w.:-]{1,64}$/.test(value) ? value : bad(`${what} is not valid.`))
const color = (value: unknown): string | undefined =>
  value === undefined ? undefined : typeof value === 'string' && (/^#[0-9a-f]{6}$/i.test(value) || /^(grey|blue|red|yellow|green|pink|purple|cyan|orange)$/.test(value)) ? value : bad('The colour is not valid.')
/** An address to open from the panel: only web pages (the control layer refuses anything else too). */
const address = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw.length > 2000 || /[\x00-\x1f]/.test(raw)) return bad('The address is not valid.')
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : bad('Only web pages can be opened here.')
  } catch {
    return bad('The address is not valid.')
  }
}
const text = (value: unknown, what: string, max = 80): string => (typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : bad(`${what} is not valid.`))

/** The tab and group verbs the rail's Tabs, Tab groups, Media and Controls rows use. Every argument is checked; only listed capabilities run. */
export function createBrowserControlHandlers(get: () => PanelControl | null | undefined): Record<string, Handler> {
  const run = async (capability: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    const control = get()
    if (!control) throw Object.assign(new Error('The browser is not ready.'), { code: 'not-ready' })
    const result = await control.execute({ capability, params, source: 'user' }, { confirm: async () => true })
    if (!result.ok) throw new HelperError('failed', result.error?.message ?? 'The browser could not do that.')
    return result.data
  }
  const ACTIONS: Record<string, (a: Record<string, unknown>) => [string, Record<string, unknown>]> = {
    activate: (a) => ['tabs.activate', { tabId: id(a.tabId, 'The tab') }],
    close: (a) => ['tabs.close', { tabId: id(a.tabId, 'The tab') }],
    mute: (a) => ['tabs.mute', { tabId: id(a.tabId, 'The tab'), muted: a.muted === true }],
    pin: (a) => ['tabs.pin', { tabId: id(a.tabId, 'The tab'), pinned: a.pinned === true }],
    move: (a) => (Number.isInteger(a.index) && (a.index as number) >= 0 && (a.index as number) < 1000 ? ['tabs.move', { tabId: id(a.tabId, 'The tab'), index: a.index as number }] : bad('The position is not valid.')),
    back: () => ['navigation.back', {}],
    forward: () => ['navigation.forward', {}],
    reload: () => ['navigation.reload', {}],
    stop: () => ['navigation.stop', {}],
    'nav-info': () => ['navigation.info', {}],
    // What the Orb means by "this page": the real address, title, visible text and whatever the person has selected.
    // page.read reads; it changes nothing and asks for no confirmation, which is why the Orb may have it without one.
    'page-read': (a) => ['page.read', { maxChars: Number.isInteger(a.maxChars) && (a.maxChars as number) > 0 && (a.maxChars as number) <= 100_000 ? (a.maxChars as number) : 12_000 }],
    'zoom-get': () => ['zoom.get', {}],
    open: (a) => ['tabs.create', { url: address(a.url), active: true }],
    /*
     * Orbis Search, for some words.
     *
     * Through the surface table rather than by building an address, because a tab may only be opened at a web page --
     * `chrome://orbis-search` is the browser's own, and this is how the browser opens its own. The words go in the
     * fragment, which is where the results page reads them from.
     */
    search: (a) => ['surface.open', { name: 'orbis-search', at: `#q=${encodeURIComponent(text(a.query, 'The search', 300))}`, newTab: true }],
    zoom: (a) => {
      if (a.action === 'in' || a.action === 'out' || a.action === 'reset') return ['zoom.set', { action: a.action }]
      return typeof a.factor === 'number' && a.factor >= 0.25 && a.factor <= 5 ? ['zoom.set', { factor: a.factor }] : bad('The zoom is not valid.')
    },
    'group-create': (a) => ['groups.create', { tabIds: Array.isArray(a.tabIds) && a.tabIds.length <= 50 ? a.tabIds.map((t) => id(t, 'A tab')) : bad('The tabs are not valid.'), name: text(a.name, 'The name', 40), ...(color(a.color) ? { color: color(a.color) } : {}) }],
    'group-rename': (a) => ['groups.rename', { groupId: id(a.groupId, 'The group'), name: text(a.name, 'The name', 40), ...(color(a.color) ? { color: color(a.color) } : {}) }],
    'group-collapse': (a) => ['groups.collapse', { groupId: id(a.groupId, 'The group'), collapsed: a.collapsed === true }],
    'group-delete': (a) => ['groups.delete', { groupId: id(a.groupId, 'The group') }],
    'group-add': (a) => ['groups.addTab', { groupId: id(a.groupId, 'The group'), tabId: id(a.tabId, 'The tab') }],
    'group-remove': (a) => ['groups.removeTab', { groupId: id(a.groupId, 'The group'), tabId: id(a.tabId, 'The tab') }]
  }
  // Approvals for capabilities the Orb runs directly. The same gate the agent uses, for the same reason: something
  // that changes the world asks first, and only a literal yes counts.
  const approvals = new PendingApprovals()

  /** A parameter as it arrived, kept only when it is a shape a capability could actually take. */
  const plain = (raw: unknown): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key)) continue
      if (typeof value === 'string') { if (value.length <= 4000) out[key] = value; continue }
      if (typeof value === 'number' && Number.isFinite(value)) { out[key] = value; continue }
      if (typeof value === 'boolean' || value === null) { out[key] = value; continue }
      if (Array.isArray(value) && value.length <= 100 && value.every((v) => typeof v === 'string' && v.length <= 300)) out[key] = value
    }
    return out
  }

  return {
    'browser:tabs': () => run('tabs.list'),
    'browser:groups': () => run('groups.list'),

    /**
     * Hands an address to whatever the computer opens web pages with.
     *
     * Shift+Enter in the browser's address bar does this, and it is listed in Orbis's own list of shortcuts -- but the
     * panel was calling a channel nobody had registered, so the keystroke was swallowed and then nothing happened at
     * all. `address` allows only http and https, so this cannot be used to open a file or hand a `javascript:` line to
     * another program.
     */
    'browser:openExternal': ([target]) => run('navigation.openExternal', { url: address(target) }),

    /**
     * Everything the browser can do, as the control layer reports it. The Orb's menu is this list, so a capability
     * added anywhere in Orbis is reachable from the Orb without this file changing.
     */
    'browser:capabilities': ([filter]) => {
      const control = get()
      if (!control) throw new HelperError('no-browser', 'The browser is not ready.')
      if (typeof control.list !== 'function') throw new HelperError('unavailable', 'This browser cannot list what it can do.')
      const f = (filter ?? {}) as Record<string, unknown>
      const list = control.list(
        {
          ...(typeof f.domain === 'string' && f.domain ? { domain: f.domain.slice(0, 40) } : {}),
          ...(typeof f.query === 'string' && f.query ? { query: f.query.slice(0, 120) } : {}),
          availableOnly: f.availableOnly === true
        },
        'user'
      )
      // Only what the Orb needs to offer and explain a capability. Nothing about how it is implemented.
      return {
        capabilities: list.map((c) => ({
          id: c.id,
          domain: c.domain,
          name: c.name,
          description: c.description,
          params: c.params,
          mutates: c.mutates,
          confirmation: c.confirmation,
          available: c.available,
          ...(c.unavailableReason ? { unavailableReason: c.unavailableReason } : {})
        }))
      }
    },

    /**
     * Runs one capability by its id.
     *
     * This is what lets the Orb reach the whole browser rather than a list somebody maintained. It is not a way round
     * the safety model: the call goes through the same control layer, with the same `source: 'user'`, and anything
     * whose policy says to ask emits a `confirm` and waits for a real answer. Refusing, or closing the Orb, is a no.
     */
    'browser:run': async ([capability, params], { emit, signal }) => {
      const control = get()
      if (!control) throw new HelperError('no-browser', 'The browser is not ready.')
      const which = typeof capability === 'string' && /^[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9]+$/.test(capability) ? capability : bad('That is not a capability.')
      const known = control.list?.({}, 'user').find((c) => c.id === which)
      if (control.list && !known) throw new HelperError('bad-request', 'The browser has no such capability.')
      if (known && !known.available) throw new HelperError('unavailable', known.unavailableReason ?? `${known.name} cannot be used right now.`)

      const outcome = await control.execute(
        { capability: which, params: plain(params), source: 'user' },
        {
          confirm: () => {
            const confirmation = {
              id: `orb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
              action: known ? known.name : which,
              reason: known?.description ?? 'This changes something in the browser.'
            }
            emit({ type: 'confirm', confirmation } as never)
            return approvals.ask(confirmation, signal)
          }
        }
      )
      if (!outcome.ok) throw new HelperError('failed', outcome.error?.message ?? 'The browser could not do that.')
      return { ok: true, data: outcome.data ?? null }
    },

    /** The answer to a `confirm`. Only a literal true approves; anything else, and the action does not happen. */
    'browser:run-answer': ([id, approved]) => {
      if (typeof id !== 'string' || !id) throw new HelperError('bad-request', 'That is not an approval.')
      return { answered: approvals.answer(id, approved === true) }
    },
    'browser:do': ([action, args]) => {
      const build = typeof action === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : undefined
      if (!build) return bad('Not a browser action.')
      const [capability, params] = build(args && typeof args === 'object' ? (args as Record<string, unknown>) : {})
      return run(capability, params)
    }
  }
}
