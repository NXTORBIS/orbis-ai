import { HelperError } from './server.ts'
import type { Handler } from './server.ts'

/** The Browser Control Layer, as far as the panel may use it: run one capability, get { ok, data } or { ok: false, error }. */
export interface PanelControl {
  execute(call: { capability: string; params: Record<string, unknown>; source: 'user' }, options: { confirm: () => Promise<boolean> }): Promise<{ ok: boolean; data?: unknown; error?: { message?: string } }>
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
    'zoom-get': () => ['zoom.get', {}],
    open: (a) => ['tabs.create', { url: address(a.url), active: true }],
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
  return {
    'browser:tabs': () => run('tabs.list'),
    'browser:groups': () => run('groups.list'),
    'browser:do': ([action, args]) => {
      const build = typeof action === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : undefined
      if (!build) return bad('Not a browser action.')
      const [capability, params] = build(args && typeof args === 'object' ? (args as Record<string, unknown>) : {})
      return run(capability, params)
    }
  }
}
