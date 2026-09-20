import type { ParamSpec } from '../shared/browserControl.ts'
import { BrowserControl, fail } from './browserControl/registry.ts'
import type { WindowControl } from './browserControl/window.ts'

/** What these capabilities need of the running Orbis browser (Chromium): its extension, where `chrome.tabs` and `chrome.windows` are. */
export interface BrowserExtrasDeps {
  control: BrowserControl
  windowControl: WindowControl
  bridge: { run<T>(expression: string): Promise<T> }
}

const str = (description: string, required = false): ParamSpec => ({ type: 'string', description, required })
const bool = (description: string): ParamSpec => ({ type: 'boolean', description, required: false })
const int = (description: string, required = false): ParamSpec => ({ type: 'integer', description, required })
const json = (value: unknown): string => JSON.stringify(value)
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Reads until `ok` holds or time runs out; returns the last value read. */
async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, ms = 2500): Promise<T> {
  const end = Date.now() + ms
  let value = await read()
  while (!ok(value) && Date.now() < end) {
    await sleep(120)
    value = await read()
  }
  return value
}

interface TabRow {
  id: number
  url: string
  title: string
  pinned: boolean
  index: number
  windowId: number
  incognito: boolean
}

/**
 * The window and tab conveniences the Orbis browser had that Chromium's own capability set does not spell out: minimize, maximize, restore,
 * fullscreen, focus, resize and move for a browser window; closing the other or the right-hand tabs; going back to the previous tab; and
 * switching to or closing a tab by what its page says (for workflows, where tab ids change between runs). All of it is Chromium's own
 * `chrome.windows` and `chrome.tabs`, reached through the Orbis extension, and each capability checks that it really happened.
 */
export function registerBrowserExtras(d: BrowserExtrasDeps): void {
  const { control, bridge } = d
  const call = <T>(expression: string): Promise<T> => bridge.run<T>(expression)
  const tabs = (): Promise<TabRow[]> =>
    call<TabRow[]>('chrome.tabs.query({}).then((all) => all.map((t) => ({ id: t.id, url: t.url || t.pendingUrl || "", title: t.title || "", pinned: !!t.pinned, index: t.index, windowId: t.windowId, incognito: !!t.incognito })))')

  // ---------------------------------------------------------------- windows

  const windowId: ParamSpec = { type: 'integer', description: 'Window id from window.list (default: the focused browser window).' }
  const target = async (id: unknown): Promise<number> => {
    if (typeof id === 'number') {
      const known = await call<boolean>(`chrome.windows.get(${json(id)}).then(() => true, () => false)`)
      if (!known) fail('not-found', `No browser window with id ${id}. See window.list.`, true)
      return id
    }
    const focused = await call<number | null>('chrome.windows.getLastFocused().then((w) => w.id, () => null)')
    return focused ?? fail('unavailable', 'The browser has no window open.', true)
  }
  const windowState = (id: string, name: string, description: string, update: (p: Record<string, unknown>) => Record<string, unknown>, check: (w: Record<string, unknown>, p: Record<string, unknown>) => boolean, extra: Record<string, ParamSpec> = {}): void =>
    control.register({
      id,
      domain: 'window',
      name,
      description,
      params: { id: windowId, ...extra },
      mutates: true,
      confirmation: 'none',
      run: async (p) => {
        const win = await target(p.id)
        await call(`chrome.windows.update(${win}, ${json(update(p))})`)
        return { id: win }
      },
      verify: async (data, p) => {
        const { id: win } = data as { id: number }
        const read = (): Promise<Record<string, unknown>> => call(`chrome.windows.get(${win})`)
        const now = await until(read, (w) => check(w, p))
        return { verified: check(now, p), detail: `${name}: the window is ${String(now.state)} at ${String(now.left)},${String(now.top)}, ${String(now.width)}x${String(now.height)}.` }
      }
    })

  windowState('window.minimize', 'Minimize', 'Minimizes a browser window.', () => ({ state: 'minimized' }), (w) => w.state === 'minimized')
  windowState('window.maximize', 'Maximize', 'Maximizes a browser window.', () => ({ state: 'maximized' }), (w) => w.state === 'maximized')
  windowState('window.restore', 'Restore', 'Restores a minimized, maximized or fullscreen browser window to its normal size.', () => ({ state: 'normal' }), (w) => w.state === 'normal')
  windowState('window.fullscreen', 'Fullscreen', 'Turns fullscreen on for a browser window, or off with on: false.', (p) => ({ state: p.on === false ? 'normal' : 'fullscreen' }), (w, p) => (p.on === false ? w.state !== 'fullscreen' : w.state === 'fullscreen'), {
    on: bool('true for fullscreen (default), false to leave it.')
  })
  windowState('window.focus', 'Focus', 'Brings a browser window to the front and focuses it.', () => ({ focused: true, drawAttention: false }), (w) => w.focused === true && w.state !== 'minimized')
  windowState(
    'window.resize',
    'Resize',
    "Sets a browser window's size.",
    (p) => ({ state: 'normal', width: Math.round(Number(p.width)), height: Math.round(Number(p.height)) }),
    (w, p) => Math.abs(Number(w.width) - Number(p.width)) <= 2 && Math.abs(Number(w.height) - Number(p.height)) <= 2,
    { width: int('Width in pixels.', true), height: int('Height in pixels.', true) }
  )
  windowState(
    'window.move',
    'Move',
    'Moves a browser window to a screen position.',
    (p) => ({ state: 'normal', left: Math.round(Number(p.x)), top: Math.round(Number(p.y)) }),
    (w, p) => Math.abs(Number(w.left) - Number(p.x)) <= 2 && Math.abs(Number(w.top) - Number(p.y)) <= 2,
    { x: int('Left edge.', true), y: int('Top edge.', true) }
  )

  // ---------------------------------------------------------------- tabs

  const tabId: ParamSpec = str('Tab id from tabs.list (default: the active tab).')
  const anchor = async (p: Record<string, unknown>, ctx: { target?: { tabId?: string } }): Promise<TabRow> => {
    const all = await tabs()
    const wanted = typeof p.tabId === 'string' && p.tabId ? p.tabId : ctx.target?.tabId
    const found = wanted ? all.find((t) => String(t.id) === String(wanted)) : all.find((t) => String(t.id) === String(d.windowControl.state?.activeTabId))
    return found ?? fail('not-found', wanted ? `No tab with id ${wanted}. Read tabs.list.` : 'There is no active tab.', true)
  }
  const closeAll = async (ids: number[]): Promise<void> => {
    if (ids.length) await call(`chrome.tabs.remove(${json(ids)})`)
  }

  control.register({
    id: 'tabs.closeOthers',
    domain: 'tabs',
    name: 'Close other tabs',
    description: 'Closes every unpinned tab except this one, in its window.',
    params: { tabId },
    mutates: true,
    confirmation: 'always',
    describe: () => 'Close every other tab',
    run: async (p, ctx) => {
      const keep = await anchor(p, ctx)
      const doomed = (await tabs()).filter((t) => t.windowId === keep.windowId && t.id !== keep.id && !t.pinned).map((t) => t.id)
      await closeAll(doomed)
      return { kept: String(keep.id), closed: doomed.length, ids: doomed }
    },
    verify: async (data) => {
      const { ids } = data as { ids: number[] }
      const left = await until(tabs, (all) => !all.some((t) => ids.includes(t.id)))
      const open = left.filter((t) => ids.includes(t.id)).length
      return { verified: open === 0, detail: open ? `${open} of those tabs are still open.` : 'Only this tab and pinned tabs remain.' }
    }
  })

  control.register({
    id: 'tabs.closeRight',
    domain: 'tabs',
    name: 'Close tabs to the right',
    description: 'Closes the unpinned tabs to the right of this one, in its window.',
    params: { tabId },
    mutates: true,
    confirmation: 'none',
    run: async (p, ctx) => {
      const from = await anchor(p, ctx)
      const doomed = (await tabs()).filter((t) => t.windowId === from.windowId && t.index > from.index && !t.pinned).map((t) => t.id)
      await closeAll(doomed)
      return { closed: doomed.length, ids: doomed }
    },
    verify: async (data) => {
      const { ids } = data as { ids: number[] }
      const left = await until(tabs, (all) => !all.some((t) => ids.includes(t.id)))
      const open = left.filter((t) => ids.includes(t.id)).length
      return { verified: open === 0, detail: open ? `${open} of those tabs are still open.` : `Closed ${ids.length} tab${ids.length === 1 ? '' : 's'}.` }
    }
  })

  control.register({
    id: 'tabs.activatePrevious',
    domain: 'tabs',
    name: 'Switch to the previous tab',
    description: 'Switches back to the tab that was active before the current one.',
    params: {},
    mutates: true,
    confirmation: 'none',
    run: async () => {
      const previous = d.windowControl.state?.previousTabId
      const all = await tabs()
      const tab = previous ? all.find((t) => String(t.id) === previous) : undefined
      if (!tab) fail('not-found', 'There is no previously used tab that is still open.')
      await call(`chrome.tabs.update(${tab!.id}, { active: true }).then(() => chrome.windows.update(${tab!.windowId}, { focused: true }))`)
      return { tabId: String(tab!.id) }
    },
    verify: async (data) => {
      const { tabId: id } = data as { tabId: string }
      const active = await until(() => call<boolean>(`chrome.tabs.get(${Number(id)}).then((t) => t.active)`), Boolean)
      return { verified: active, detail: active ? 'Switched back to the previous tab.' : 'That tab is not active.' }
    }
  })

  for (const verb of ['activate', 'close'] as const) {
    control.register({
      id: verb === 'activate' ? 'tabs.activateMatching' : 'tabs.closeMatching',
      domain: 'tabs',
      name: verb === 'activate' ? 'Switch to a tab by its page' : 'Close a tab by its page',
      description: `${verb === 'activate' ? 'Switches to' : 'Closes'} the tab whose address or title contains some text (for workflows, where tab ids change between runs). When several tabs match, it says which and asks for an index${verb === 'close' ? ' (or all: true)' : ''}.`,
      params: { urlContains: str('Text in the address.'), titleContains: str('Text in the title.'), index: int('Which match (0 = first), when several match.'), ...(verb === 'close' ? { all: bool('Close every match.') } : {}) },
      mutates: true,
      confirmation: 'none',
      run: async (p) => {
        const url = typeof p.urlContains === 'string' ? p.urlContains.toLowerCase() : ''
        const title = typeof p.titleContains === 'string' ? p.titleContains.toLowerCase() : ''
        if (!url && !title) fail('invalid-params', 'Give urlContains or titleContains.')
        const all = await tabs()
        const matches = all.filter((t) => (!url || t.url.toLowerCase().includes(url)) && (!title || t.title.toLowerCase().includes(title)))
        if (!matches.length) fail('not-found', `No tab matches. Open tabs: ${all.map((t) => t.url || 'blank').join(', ')}.`, true)
        const every = verb === 'close' && p.all === true
        if (matches.length > 1 && typeof p.index !== 'number' && !every) {
          fail('invalid-params', `${matches.length} tabs match: ${matches.map((t, i) => `${i}: ${t.title} (${t.url})`).join('; ')}. Say which with index.`)
        }
        const chosen = every ? matches : [matches[Math.max(0, Math.min(Number(p.index ?? 0), matches.length - 1))]]
        if (verb === 'activate') {
          await call(`chrome.tabs.update(${chosen[0].id}, { active: true }).then(() => chrome.windows.update(${chosen[0].windowId}, { focused: true }))`)
          return { tabId: String(chosen[0].id), url: chosen[0].url }
        }
        await closeAll(chosen.map((t) => t.id))
        return { closed: chosen.length, ids: chosen.map((t) => t.id) }
      },
      verify: async (data) => {
        if (verb === 'activate') {
          const { tabId: id } = data as { tabId: string }
          const active = await until(() => call<boolean>(`chrome.tabs.get(${Number(id)}).then((t) => t.active)`), Boolean)
          return { verified: active, detail: active ? 'Switched to it.' : 'The tab is not active.' }
        }
        const { ids } = data as { ids: number[] }
        const left = await until(tabs, (all) => !all.some((t) => ids.includes(t.id)))
        const open = left.filter((t) => ids.includes(t.id)).length
        return { verified: open === 0, detail: open ? 'A matching tab is still open.' : `Closed ${ids.length} tab${ids.length === 1 ? '' : 's'}.` }
      }
    })
  }

  // ---------------------------------------------------------------- downloads

  control.register({
    id: 'downloads.open',
    domain: 'downloads',
    name: 'Open a downloaded file',
    description: "Opens a finished download with the program Windows uses for that kind of file. Files can run programs, so Orbis asks first.",
    params: { id: str('Download id from downloads.list.', true) },
    mutates: true,
    confirmation: 'always',
    describe: (p) => `Open download ${String(p.id)} with its default program`,
    run: async (p) => {
      const id = Number(p.id)
      const found = await call<{ state: string; exists: boolean } | null>(`chrome.downloads.search({ id: ${id} }).then((r) => (r[0] ? { state: r[0].state, exists: r[0].exists } : null))`)
      if (!found) fail('not-found', `No download ${String(p.id)}. See downloads.list.`, true)
      if (found!.state !== 'complete' || !found!.exists) fail('invalid-params', 'That download has not finished, or its file is gone.', true)
      await call(`chrome.downloads.open(${id})`)
      return { id: String(id) }
    },
    verify: () => ({ verified: false, detail: 'Windows was asked to open the file; whether a program started is not visible to Orbis.' })
  })
}
