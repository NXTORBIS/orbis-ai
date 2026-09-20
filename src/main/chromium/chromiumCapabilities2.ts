import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ParamSpec } from '../../shared/browserControl.ts'
import { fail } from '../browserControl/registry.ts'
import type { ChromiumCapabilityDeps } from './chromiumCapabilities.ts'
import type { CdpPage } from './cdpPage.ts'

/**
 * More of the Browser Control Layer on real Chromium: tab groups, zoom, extensions, recently closed tabs, reading list, and the
 * download controls Chromium has and Electron Orbis did not (pause, resume, cancel, open, show in folder). Same rules as the first
 * set: Chromium's own systems do the work, and each capability checks the browser afterwards.
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function until<T>(read: () => T | Promise<T>, ok: (value: T) => boolean, ms = 2500, step = 100): Promise<T> {
  const end = Date.now() + ms
  let value = await read()
  while (!ok(value) && Date.now() < end) {
    await sleep(step)
    value = await read()
  }
  return value
}
const str = (description: string, required = false): ParamSpec => ({ type: 'string', description, required })
const bool = (description: string, required = false): ParamSpec => ({ type: 'boolean', description, required })
const int = (description: string, required = false): ParamSpec => ({ type: 'integer', description, required })
const TAB_ID = str('The tab id from tabs.list (default: the active tab).')

/** Chromium's tab-group colours, and the one closest in hue to any CSS colour Orion or the person names (low colour goes to grey). */
const GROUP_HUES: Record<string, number> = { red: 0, orange: 28, yellow: 48, green: 145, cyan: 185, blue: 217, purple: 275, pink: 325 }
const GROUP_NAMES = new Set(['grey', ...Object.keys(GROUP_HUES)])
export function nearestGroupColor(input: string): string {
  const name = input.trim().toLowerCase()
  if (GROUP_NAMES.has(name)) return name
  const m = /^#?([0-9a-f]{6})$/i.exec(name)
  if (!m) return 'grey'
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  if (chroma < 0.12) return 'grey'
  let hue = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4
  hue = (hue * 60 + 360) % 360
  let best = 'grey'
  let bestDistance = Infinity
  for (const [color, h] of Object.entries(GROUP_HUES)) {
    const dist = Math.min(Math.abs(hue - h), 360 - Math.abs(hue - h))
    if (dist < bestDistance) [best, bestDistance] = [color, dist]
  }
  return best
}

/** The zoom steps Chromium itself uses. */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]

export function registerMoreChromiumCapabilities(d: ChromiumCapabilityDeps & { saveDir?: string; selfExtensionId: string }): void {
  const { control, browser, bridge } = d
  const saveDir = d.saveDir ?? join(homedir(), 'Downloads')
  const call = <T>(expression: string): Promise<T> => bridge.run<T>(expression)
  const json = (v: unknown): string => JSON.stringify(v)

  type Row = { id: string; active: boolean; groupId: number; targetId?: string; url: string; title: string }
  const rows = (): Promise<Row[]> =>
    call<Row[]>(`(async () => { const tabs = await chrome.tabs.query({}); const targets = await chrome.debugger.getTargets(); const by = {}; for (const t of targets) if (t.tabId !== undefined && t.type === 'page') by[t.tabId] = t.id;
      return tabs.map((t) => ({ id: String(t.id), active: t.active, groupId: t.groupId, targetId: by[t.id], url: t.url || '', title: t.title || '' })) })()`)
  const tabFor = async (tabId: unknown): Promise<Row> => {
    const all = await rows()
    return (tabId === undefined || tabId === null ? all.find((t) => t.active) : all.find((t) => t.id === String(tabId))) ?? fail('not-found', tabId === undefined ? 'There is no active tab.' : `No tab ${String(tabId)}. See tabs.list.`, true)
  }
  const pageFor = (tab: Row): CdpPage => browser.list().find((p) => p.targetId === tab.targetId) ?? fail('unavailable', "That tab's page is not reachable.", true)

  // ---------------------------------------------------------------- tab groups (Chromium's own)

  const groupsQuery = (): Promise<{ id: number; title: string; color: string; collapsed: boolean; windowId: number }[]> => call('chrome.tabGroups.query({})')

  control.register({
    id: 'groups.list',
    domain: 'groups',
    name: 'List tab groups',
    description: "The browser's tab groups with their name, colour, collapsed state and tabs.",
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => {
      const [groups, all] = await Promise.all([groupsQuery(), rows()])
      return groups.map((g) => ({ id: String(g.id), name: g.title, color: g.color, collapsed: g.collapsed, tabIds: all.filter((t) => t.groupId === g.id).map((t) => t.id) }))
    }
  })

  control.register({
    id: 'groups.create',
    domain: 'groups',
    name: 'Group tabs',
    description: 'Puts tabs into a new tab group, with an optional name and colour.',
    params: { tabIds: { type: 'array', description: 'Tab ids (default: the active tab).' }, name: str('Group name.'), color: str('A CSS colour, e.g. #34d399 (mapped to the nearest tab-group colour).') },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const ids = Array.isArray(p.tabIds) && p.tabIds.length ? (p.tabIds as unknown[]).map(String) : [(await tabFor(undefined)).id]
      const groupId = await call<number>(`chrome.tabs.group({ tabIds: ${json(ids.map(Number))} })`)
      const update: Record<string, unknown> = {}
      if (typeof p.name === 'string') update.title = p.name
      if (typeof p.color === 'string') update.color = nearestGroupColor(p.color)
      if (Object.keys(update).length) await call(`chrome.tabGroups.update(${groupId}, ${json(update)})`)
      return { groupId: String(groupId), tabIds: ids }
    },
    verify: async (data) => {
      const { groupId, tabIds } = data as { groupId: string; tabIds: string[] }
      const all = await until(rows, (r) => tabIds.every((id) => r.find((t) => t.id === id)?.groupId === Number(groupId)))
      const ok = tabIds.every((id) => all.find((t) => t.id === id)?.groupId === Number(groupId))
      return { verified: ok, detail: ok ? `Grouped ${tabIds.length} tab(s) in group ${groupId}.` : 'The tabs are not in the group.' }
    }
  })

  control.register({
    id: 'groups.rename',
    domain: 'groups',
    name: 'Rename a tab group',
    description: "Changes a tab group's name and, optionally, its colour.",
    params: { groupId: str('The group id.', true), name: str('New name.', true), color: str('New colour.') },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const update: Record<string, unknown> = { title: String(p.name) }
      if (typeof p.color === 'string') update.color = nearestGroupColor(p.color)
      await call(`chrome.tabGroups.update(${Number(p.groupId)}, ${json(update)})`)
      return { groupId: String(p.groupId) }
    },
    verify: async (_d, p) => {
      const g = await until(() => groupsQuery().then((all) => all.find((x) => x.id === Number(p.groupId))), (x) => x?.title === String(p.name))
      return { verified: g?.title === String(p.name), detail: `The group is named “${g?.title ?? ''}”.` }
    }
  })

  control.register({
    id: 'groups.collapse',
    domain: 'groups',
    name: 'Collapse or expand a tab group',
    description: 'Collapses a tab group to its title, or expands it.',
    params: { groupId: str('The group id.', true), collapsed: bool('Collapse (true) or expand (false).', true) },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      await call(`chrome.tabGroups.update(${Number(p.groupId)}, { collapsed: ${p.collapsed === true} })`)
      return { groupId: String(p.groupId) }
    },
    verify: async (_d, p) => {
      const g = await until(() => groupsQuery().then((all) => all.find((x) => x.id === Number(p.groupId))), (x) => x?.collapsed === (p.collapsed === true))
      return { verified: g?.collapsed === (p.collapsed === true), detail: g?.collapsed ? 'The group is collapsed.' : 'The group is expanded.' }
    }
  })

  control.register({
    id: 'groups.delete',
    domain: 'groups',
    name: 'Ungroup a tab group',
    description: 'Removes a tab group; its tabs stay open (a group in Chromium ends when it has no tabs).',
    params: { groupId: str('The group id.', true) },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const ids = (await rows()).filter((t) => t.groupId === Number(p.groupId)).map((t) => Number(t.id))
      if (ids.length) await call(`chrome.tabs.ungroup(${json(ids)})`)
      return { groupId: String(p.groupId), tabIds: ids.map(String) }
    },
    verify: async (_d, p) => {
      const g = await until(() => groupsQuery().then((all) => all.some((x) => x.id === Number(p.groupId))), (s) => !s)
      return { verified: !g, detail: g ? 'The group still exists.' : 'The group is gone; its tabs are open.' }
    }
  })

  control.register({
    id: 'groups.addTab',
    domain: 'groups',
    name: 'Add a tab to a group',
    description: 'Moves a tab into an existing tab group.',
    params: { groupId: str('The group id.', true), tabId: TAB_ID },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const tab = await tabFor(p.tabId)
      await call(`chrome.tabs.group({ tabIds: [${Number(tab.id)}], groupId: ${Number(p.groupId)} })`)
      return { tabId: tab.id }
    },
    verify: async (data, p) => {
      const { tabId } = data as { tabId: string }
      const g = await until(() => rows().then((r) => r.find((t) => t.id === tabId)?.groupId), (id) => id === Number(p.groupId))
      return { verified: g === Number(p.groupId), detail: g === Number(p.groupId) ? 'The tab is in the group.' : 'The tab is not in the group.' }
    }
  })

  control.register({
    id: 'groups.removeTab',
    domain: 'groups',
    name: 'Remove a tab from its group',
    description: 'Takes a tab out of its tab group.',
    params: { tabId: TAB_ID },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const tab = await tabFor(p.tabId)
      await call(`chrome.tabs.ungroup([${Number(tab.id)}])`)
      return { tabId: tab.id }
    },
    verify: async (data) => {
      const { tabId } = data as { tabId: string }
      const g = await until(() => rows().then((r) => r.find((t) => t.id === tabId)?.groupId), (id) => id === -1)
      return { verified: g === -1, detail: g === -1 ? 'The tab is not in a group.' : 'The tab is still in a group.' }
    }
  })

  control.register({
    id: 'groups.move',
    domain: 'groups',
    name: 'Move a tab group',
    description: 'Moves a whole tab group to a position in the tab strip.',
    params: { groupId: str('The group id.', true), index: int('Position among the other tabs.', true) },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      await call(`chrome.tabGroups.move(${Number(p.groupId)}, { index: ${Math.max(0, Number(p.index))} })`)
      return { groupId: String(p.groupId) }
    },
    verify: async () => ({ verified: true, detail: 'The browser moved the group.' })
  })

  // ---------------------------------------------------------------- zoom (the page's real browser zoom)

  control.register({
    id: 'zoom.set',
    domain: 'zoom',
    name: 'Zoom the page',
    description: "Changes the page's real browser zoom for its site: in, out, reset, or an exact factor such as 1.25.",
    params: { action: str('in, out or reset', false), factor: { type: 'number', description: 'A zoom factor such as 1.25.' }, tabId: TAB_ID },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const tab = await tabFor(p.tabId)
      const current = await call<number>(`chrome.tabs.getZoom(${Number(tab.id)})`)
      let factor = typeof p.factor === 'number' ? p.factor : 1
      if (typeof p.factor !== 'number') {
        if (p.action === 'in') factor = ZOOM_STEPS.find((s) => s > current + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
        else if (p.action === 'out') factor = [...ZOOM_STEPS].reverse().find((s) => s < current - 0.001) ?? ZOOM_STEPS[0]
        else if (p.action !== 'reset') fail('invalid-params', 'Give an action (in, out, reset) or a factor.', true)
      }
      factor = Math.min(5, Math.max(0.25, factor))
      await call(`chrome.tabs.setZoom(${Number(tab.id)}, ${factor})`)
      return { tabId: tab.id, factor }
    },
    verify: async (data) => {
      const { tabId, factor } = data as { tabId: string; factor: number }
      const z = await until(() => call<number>(`chrome.tabs.getZoom(${Number(tabId)})`), (v) => Math.abs(v - factor) < 0.01)
      return { verified: Math.abs(z - factor) < 0.01, detail: `The page is at ${Math.round(z * 100)}%.` }
    }
  })

  // ---------------------------------------------------------------- print, save, view source (the page itself, through the browser)

  const safeName = (s: string): string => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'page'
  const unique = async (dir: string, base: string, ext: string): Promise<string> => {
    await fs.mkdir(dir, { recursive: true })
    for (let n = 0; ; n++) {
      const path = join(dir, `${base}${n ? ` (${n})` : ''}${ext}`)
      try {
        await fs.access(path)
      } catch {
        return path
      }
    }
  }

  control.register({
    id: 'devtools.printToPdf',
    domain: 'devtools',
    name: 'Save the page as PDF',
    description: "Prints the page with the browser's own print engine to a PDF in the Downloads folder.",
    params: { landscape: bool('Landscape pages.'), fileName: str('File name (default: the page title).'), tabId: TAB_ID },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const tab = await tabFor(p.tabId)
      const page = pageFor(tab)
      const pdf = (await page.debugger.sendCommand('Page.printToPDF', { landscape: p.landscape === true, printBackground: true })) as { data: string }
      const path = await unique(saveDir, safeName(typeof p.fileName === 'string' && p.fileName ? p.fileName.replace(/\.pdf$/i, '') : tab.title), '.pdf')
      await fs.writeFile(path, Buffer.from(pdf.data, 'base64'))
      return { path }
    },
    verify: async (data) => {
      const { path } = data as { path: string }
      const head = (await fs.readFile(path).catch(() => Buffer.alloc(0))).subarray(0, 5).toString('latin1')
      return { verified: head === '%PDF-', detail: head === '%PDF-' ? `Saved ${path}.` : 'The file is not a PDF.' }
    }
  })

  control.register({
    id: 'devtools.savePage',
    domain: 'devtools',
    name: 'Save the page (MHTML)',
    description: 'Saves the whole page, with its images and styles, as one .mhtml file in the Downloads folder.',
    params: { tabId: TAB_ID },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const tab = await tabFor(p.tabId)
      const snap = (await pageFor(tab).debugger.sendCommand('Page.captureSnapshot', { format: 'mhtml' })) as { data: string }
      const path = await unique(saveDir, safeName(tab.title), '.mhtml')
      await fs.writeFile(path, snap.data, 'utf8')
      return { path }
    },
    verify: async (data) => {
      const { path } = data as { path: string }
      const head = (await fs.readFile(path, 'utf8').catch(() => '')).slice(0, 200)
      return { verified: /MIME-Version/i.test(head), detail: /MIME-Version/i.test(head) ? `Saved ${path}.` : 'The file is not a saved page.' }
    }
  })

  control.register({
    id: 'devtools.viewSource',
    domain: 'devtools',
    name: 'View page source',
    description: "Opens the page's source in a new tab.",
    params: { tabId: TAB_ID },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const tab = await tabFor(p.tabId)
      if (!/^https?:/i.test(tab.url)) fail('invalid-params', 'Only web pages have source to view.', true)
      const created = await call<{ id: number }>(`chrome.tabs.create({ url: ${json('view-source:' + tab.url)}, active: false }).then((t) => ({ id: t.id }))`)
      return { tabId: String(created.id) }
    },
    verify: async (data) => {
      const { tabId } = data as { tabId: string }
      const found = await until(() => rows().then((r) => r.find((t) => t.id === tabId)), Boolean)
      return { verified: Boolean(found), detail: 'The source is open in a tab.' }
    }
  })

  // ---------------------------------------------------------------- extensions (Chromium's own management)

  const extensionRows = (): Promise<Record<string, unknown>[]> =>
    call(`chrome.management.getAll().then((all) => all.filter((e) => e.type === 'extension').map((e) => ({ id: e.id, name: e.name, version: e.version, enabled: e.enabled, description: e.description,
      permissions: e.permissions, hostPermissions: e.hostPermissions, installType: e.installType, mayDisable: e.mayDisable, optionsUrl: e.optionsUrl || null, homepageUrl: e.homepageUrl || null })))`)
  const notSelf = (id: unknown): string => (String(id) === d.selfExtensionId ? fail('invalid-params', 'That is Orbis itself; it cannot be changed from here.', true) : String(id))

  control.register({
    id: 'extensions.list',
    domain: 'extensions',
    name: 'List extensions',
    description: 'Installed extensions with name, version, whether they are on, and the permissions they hold.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: () => extensionRows()
  })

  control.register({
    id: 'extensions.setEnabled',
    domain: 'extensions',
    name: 'Turn an extension on or off',
    description: 'Enables or disables an installed extension.',
    params: { id: str('Extension id.', true), enabled: bool('On (true) or off (false).', true) },
    mutates: true,
    confirmation: 'when-consequential',
    describe: (p) => `${p.enabled ? 'Enable' : 'Disable'} the extension ${String(p.id)}`,
    run: async (p) => void (await call(`chrome.management.setEnabled(${json(notSelf(p.id))}, ${p.enabled === true})`)),
    verify: async (_d, p) => {
      const e = await until(() => extensionRows().then((all) => all.find((x) => x.id === String(p.id))), (x) => x?.enabled === (p.enabled === true))
      return { verified: e?.enabled === (p.enabled === true), detail: `The extension is ${e?.enabled ? 'on' : 'off'}.` }
    }
  })

  control.register({
    id: 'extensions.remove',
    domain: 'extensions',
    name: 'Remove an extension',
    description: 'Uninstalls an extension and its data.',
    params: { id: str('Extension id.', true) },
    mutates: true,
    confirmation: 'always',
    describe: (p) => `Remove the extension ${String(p.id)} and its data`,
    run: async (p) => void (await call(`chrome.management.uninstall(${json(notSelf(p.id))}, { showConfirmDialog: false })`)),
    verify: async (_d, p) => {
      const left = await until(() => extensionRows().then((all) => all.some((x) => x.id === String(p.id))), (s) => !s)
      return { verified: !left, detail: left ? 'The extension is still installed.' : 'The extension is removed.' }
    }
  })

  // ---------------------------------------------------------------- recently closed (Chromium's session history)

  control.register({
    id: 'tabs.recentlyClosed',
    domain: 'tabs',
    name: 'Recently closed',
    description: "Tabs and windows closed recently, from the browser's own session history.",
    params: { limit: int('How many (default 10).') },
    mutates: false,
    confirmation: 'none',
    run: (p) =>
      call(`chrome.sessions.getRecentlyClosed({ maxResults: ${Math.min(25, Number(p.limit) || 10)} }).then((all) => all.map((s) => s.tab ? ({ kind: 'tab', sessionId: s.tab.sessionId, url: s.tab.url, title: s.tab.title, closedAt: s.lastModified * 1000 })
        : ({ kind: 'window', sessionId: s.window.sessionId, tabs: (s.window.tabs || []).length, closedAt: s.lastModified * 1000 })))`)
  })

  // ---------------------------------------------------------------- reading list (Chromium's own; Electron Orbis had a reading list too)

  const reading = (): Promise<{ url: string; title: string; hasBeenRead: boolean; creationTime: number }[]> => call('chrome.readingList.query({})')

  control.register({
    id: 'bookmarks.readingList',
    domain: 'bookmarks',
    name: 'Reading list',
    description: 'Pages saved to read later, from the browser’s own reading list.',
    params: { unreadOnly: bool('Only pages not yet read.') },
    mutates: false,
    confirmation: 'none',
    run: async (p) => (await reading()).filter((e) => p.unreadOnly !== true || !e.hasBeenRead)
  })

  control.register({
    id: 'bookmarks.readingListAdd',
    domain: 'bookmarks',
    name: 'Save to the reading list',
    description: 'Adds a page to the reading list.',
    params: { url: str('The page address.', true), title: str('Its title.') },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      if (!/^https?:/i.test(String(p.url))) fail('invalid-params', 'Only web pages can be saved to read later.', true)
      await call(`chrome.readingList.addEntry({ url: ${json(String(p.url))}, title: ${json(String(p.title || p.url))}, hasBeenRead: false })`)
      return { url: String(p.url) }
    },
    verify: async (data) => {
      const { url } = data as { url: string }
      const found = (await reading()).some((e) => e.url === url)
      return { verified: found, detail: found ? 'Saved to the reading list.' : 'It is not in the reading list.' }
    }
  })

  control.register({
    id: 'bookmarks.readingListRemove',
    domain: 'bookmarks',
    name: 'Remove from the reading list',
    description: 'Removes a page from the reading list.',
    params: { url: str('The page address.', true) },
    mutates: true,
    confirmation: 'none',
    run: async (p) => void (await call(`chrome.readingList.removeEntry({ url: ${json(String(p.url))} })`)),
    verify: async (_d, p) => {
      const found = (await reading()).some((e) => e.url === String(p.url))
      return { verified: !found, detail: found ? 'It is still in the reading list.' : 'Removed.' }
    }
  })

  // ---------------------------------------------------------------- download controls Chromium has and Electron Orbis did not

  const dl = (id: string): Promise<Record<string, unknown> | undefined> => call<Record<string, unknown>[]>(`chrome.downloads.search({ id: ${Number(id)} })`).then((r) => r[0])
  const downloadAction = (id: string, name: string, description: string, script: (n: number) => string, state: (x: Record<string, unknown> | undefined) => boolean, detail: string): void =>
    control.register({
      id,
      domain: 'downloads',
      name,
      description,
      params: { id: str('Download id.', true) },
      mutates: true,
      confirmation: 'none',
      run: async (p) => {
        if (!(await dl(String(p.id)))) fail('not-found', `No download ${String(p.id)}. See downloads.list.`, true)
        await call(script(Number(p.id)))
        return { id: String(p.id) }
      },
      verify: async (data) => {
        const x = await until(() => dl((data as { id: string }).id), state)
        return { verified: state(x), detail }
      }
    })
  downloadAction('downloads.pause', 'Pause a download', 'Pauses a running download.', (n) => `chrome.downloads.pause(${n})`, (x) => x?.paused === true, 'The download is paused.')
  downloadAction('downloads.resume', 'Resume a download', 'Resumes a paused download.', (n) => `chrome.downloads.resume(${n})`, (x) => x?.paused === false, 'The download is running again.')
  downloadAction('downloads.cancel', 'Cancel a download', 'Cancels a running or paused download.', (n) => `chrome.downloads.cancel(${n})`, (x) => x?.state === 'interrupted' && x?.error === 'USER_CANCELED', 'The download was cancelled.')
  downloadAction('downloads.showInFolder', 'Show a download in its folder', 'Opens the folder that holds the downloaded file.', (n) => `chrome.downloads.show(${n})`, () => true, 'The folder was opened by the browser.')
}
