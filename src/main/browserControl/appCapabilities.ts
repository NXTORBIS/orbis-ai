import { clipboard, ClipboardItem, nativeImage, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import type { Settings, SettingsUpdate } from '../../shared/types'
import type { Condition, ParamSpec } from '../../shared/browserControl.ts'
import { readPath } from '../../shared/browserControl.ts'
import type { Store } from '../store'
import type { PageHandle } from '../pageHandle'
import { BrowserControl, fail } from './registry.ts'
import type { ControlContext } from './registry.ts'
import * as page from './page.ts'
import type { Locator } from './page.ts'
import { compare } from './runner.ts'
import type { WindowControl } from './window.ts'

export interface AppCapabilityDeps {
  control: BrowserControl
  windowControl: WindowControl
  getWindow(): BrowserWindow | null
  store: Store
  onSettingsChanged(settings: Settings): void
  /** The page a page-reading check acts on: the Orbis browser's (Chromium's) tab the command names, or its active tab. Throws when there is none. */
  resolvePage(ctx: Pick<ControlContext, 'target'>): PageHandle
  /** The Orbis browser (Chromium): opened on demand, closed when asked. */
  browser: {
    open(input: string): Promise<{ ok: boolean; detail: string }>
    close(): Promise<void>
    isOpen(): boolean
    /** Opens a saved set of pages and groups in the browser; what it did. */
    openWorkspace(tabs: Record<string, unknown>[], groups: Record<string, unknown>[], replace: boolean): Promise<{ tabIds: string[]; groups: string[] }>
  }
}

const str = (description: string, required = false, extra: Partial<ParamSpec> = {}): ParamSpec => ({ type: 'string', description, required, ...extra })
const bool = (description: string, required = false): ParamSpec => ({ type: 'boolean', description, required })
const int = (description: string, required = false): ParamSpec => ({ type: 'integer', description, required })

/** Settings the control layer may change, and how each is checked. The API key is never settable this way. */
const SETTINGS: Record<string, { type: 'boolean' | 'string'; values?: string[]; description: string }> = {
  theme: { type: 'string', values: ['system', 'light', 'dark'], description: 'Appearance: system, light or dark.' },
  effects: { type: 'boolean', description: 'Animated background and motion effects.' },
  defaultModel: { type: 'string', description: 'The model new chats use.' },
  reasoningEffort: { type: 'string', values: ['low', 'high', 'max'], description: 'How much the model reasons by default.' },
  autoFallback: { type: 'boolean', description: 'Switch to another model when one is unavailable.' },
  assistantName: { type: 'string', description: "The assistant's name." },
  userName: { type: 'string', description: "The user's name." },
  userTitle: { type: 'string', description: 'How the assistant addresses the user.' },
  systemPrompt: { type: 'string', description: 'Custom instructions for every chat.' },
  searchSuggestions: { type: 'boolean', description: 'Address bar asks the search engine and Orion for predictions (sends typed text).' },
  personalizedSuggestions: { type: 'boolean', description: 'Address bar suggests from local history, searches and bookmarks.' },
  openBrowserOnLaunch: { type: 'boolean', description: 'Startup: open the browser instead of the chat.' }
}

/**
 * The capabilities that belong to the Orbis app itself rather than to a browser: its settings, the system clipboard, and
 * the state and condition readers everything else relies on. Everything about tabs, windows, downloads, history, bookmarks,
 * extensions, permissions and developer tools is Chromium's, registered by `src/main/chromium`.
 */
export function registerAppCapabilities(d: AppCapabilityDeps): void {
  const { control, windowControl } = d

  control.registerState('settings', async () => d.store.getSettings())

  control.register({
    id: 'browser.open',
    domain: 'browser',
    name: 'Open the browser',
    description: 'Opens the Orbis browser (Chromium), optionally at an address or a search.',
    params: { url: str('An address or search text to open.') },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const opened = await d.browser.open(typeof p.url === 'string' ? p.url.trim() : '')
      if (!opened.ok) fail('failed', opened.detail, true)
      return { detail: opened.detail }
    },
    verify: () => ({ verified: d.browser.isOpen(), detail: d.browser.isOpen() ? 'The browser is open.' : 'The browser did not open.' })
  })

  control.register({
    id: 'browser.openWorkspace',
    domain: 'browser',
    name: 'Open a workspace',
    description: 'Opens a saved set of pages and groups. With replace, the pages that are open and not part of it are closed first.',
    params: {
      tabs: { type: 'array', description: 'The pages: url, title, pinned, group, active.', required: true },
      groups: { type: 'array', description: 'The groups: name, color, collapsed.' },
      replace: bool('Close the pages that are not part of it (default true).')
    },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const wanted = (Array.isArray(p.tabs) ? p.tabs : []).filter((t): t is Record<string, unknown> => Boolean(t) && typeof (t as { url?: unknown }).url === 'string' && /^https?:[/][/]/i.test((t as { url: string }).url))
      if (!wanted.length) fail('invalid-params', 'That workspace has no pages in it.')
      return d.browser.openWorkspace(wanted, Array.isArray(p.groups) ? (p.groups as Record<string, unknown>[]) : [], p.replace !== false)
    },
    verify: async (data) => {
      const { tabIds } = data as { tabIds: string[] }
      // The tab list follows the browser's own events; give it a moment to catch up with what was just opened.
      const deadline = Date.now() + 2500
      let missing = tabIds.length
      while (Date.now() < deadline) {
        const open = new Set((windowControl.state?.tabs ?? []).map((t) => t.id))
        missing = tabIds.filter((id) => !open.has(id)).length
        if (!missing) break
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
      return { verified: missing === 0, detail: missing ? `${missing} of ${tabIds.length} pages are not showing yet.` : `Opened ${tabIds.length} pages.` }
    }
  })

  control.register({
    id: 'navigation.openExternal',
    domain: 'navigation',
    name: 'Open in the default browser',
    description: "Opens a tab's page (or an address) in the system's default browser.",
    params: { url: str("An address (default: the active tab's page)."), tabId: str('Tab id from tabs.list.') },
    mutates: true,
    confirmation: 'none',
    run: async (p, ctx) => {
      const given = typeof p.url === 'string' ? p.url.trim() : ''
      const url = given || d.resolvePage({ target: p.tabId ? { tabId: String(p.tabId) } : ctx.target }).getURL()
      if (!/^https?:[/][/]/i.test(url)) fail('invalid-params', 'There is no web page to open.')
      await shell.openExternal(url)
      return { url }
    },
    verify: (data) => ({ verified: true, detail: `Handed ${(data as { url: string }).url} to the default browser.` })
  })

  control.register({
    id: 'browser.close',
    domain: 'browser',
    name: 'Close the browser',
    description: 'Closes the Orbis browser and all of its tabs.',
    params: {},
    mutates: true,
    confirmation: 'always',
    describe: () => 'Close the browser and all of its tabs',
    run: async () => {
      if (d.browser.isOpen()) await d.browser.close()
    },
    verify: () => ({ verified: !d.browser.isOpen(), detail: d.browser.isOpen() ? 'The browser is still open.' : 'The browser is closed.' })
  })

  control.register({
    id: 'settings.get',
    domain: 'settings',
    name: 'Read settings',
    description: `Orbis's settings. Changeable with settings.set: ${Object.entries(SETTINGS).map(([k, s]) => `${k} (${s.description})`).join('; ')}.`,
    params: {},
    mutates: false,
    confirmation: 'none',
    run: () => d.store.getSettings()
  })

  control.register({
    id: 'settings.set',
    domain: 'settings',
    name: 'Change a setting',
    description: `Changes one Orbis setting and applies it straight away: ${Object.keys(SETTINGS).join(', ')}.`,
    params: { key: str('The setting.', true, { enum: Object.keys(SETTINGS) }), value: { type: 'any', description: 'Its new value.', required: true } },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Set ${String(p.key)} to ${JSON.stringify(p.value)}`,
    run: async (p) => {
      const spec = SETTINGS[String(p.key)]
      if (spec.type === 'boolean' && typeof p.value !== 'boolean') fail('invalid-params', `${String(p.key)} must be true or false.`)
      if (spec.type === 'string' && typeof p.value !== 'string') fail('invalid-params', `${String(p.key)} must be text.`)
      if (spec.values && !spec.values.includes(String(p.value))) fail('invalid-params', `${String(p.key)} must be one of ${spec.values.join(', ')}.`)
      const settings = await d.store.updateSettings({ [String(p.key)]: p.value } as SettingsUpdate)
      d.onSettingsChanged(settings)
      return { key: p.key, value: (settings as unknown as Record<string, unknown>)[String(p.key)] }
    },
    verify: async (_data, p) => {
      const now = (await d.store.getSettings()) as unknown as Record<string, unknown>
      const want = typeof p.value === 'string' ? p.value.trim() : p.value
      const ok = typeof want === 'string' ? String(now[String(p.key)]).startsWith(want.slice(0, 40)) || (want === '' && typeof now[String(p.key)] === 'string') : now[String(p.key)] === want
      return { verified: ok, detail: ok ? `${String(p.key)} is now ${JSON.stringify(now[String(p.key)])}.` : `${String(p.key)} is ${JSON.stringify(now[String(p.key)])} (the value wasn't accepted).` }
    }

  })
  /** The MIME types on the clipboard now (text/plain, text/html, image/png…), without reading the data. */
  const clipboardTypes = async (): Promise<string[]> => [...new Set((await clipboard.read().catch(() => [])).flatMap((item) => item.types))]
  const clipboardData = async (type: string): Promise<Blob | null> => {
    for (const item of await clipboard.read().catch(() => [])) if (item.types.includes(type)) return (await item.getType(type).catch(() => null)) as Blob | null
    return null
  }

  control.registerState('clipboard', async () => ({ types: await clipboardTypes() }))

  control.register({
    id: 'clipboard.formats',
    domain: 'clipboard',
    name: "What's on the clipboard",
    description: 'The kinds of data on the clipboard (text/plain, text/html, image/png…) without reading its contents.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => ({ types: await clipboardTypes() })
  })

  control.register({
    id: 'clipboard.read',
    domain: 'clipboard',
    name: 'Read the clipboard',
    description: 'Reads the clipboard as text, HTML or an image (PNG data URL). It may hold something private, so Orion and automations ask first.',
    params: { format: str('text (default), html or image', false, { enum: ['text', 'html', 'image'] }) },
    mutates: false,
    confirmation: 'always',
    describe: () => 'Read what is on your clipboard',
    run: async (p) => {
      const format = String(p.format ?? 'text')
      if (format === 'text') {
        const value = await clipboard.readText()
        return { format, value, empty: !value }
      }
      const blob = await clipboardData(format === 'html' ? 'text/html' : 'image/png')
      if (!blob) return { format, empty: true }
      if (format === 'html') return { format, value: await blob.text(), empty: false }
      const png = Buffer.from(await blob.arrayBuffer())
      const size = nativeImage.createFromBuffer(png).getSize()
      return { format, dataUrl: `data:image/png;base64,${png.toString('base64')}`, ...size, empty: false }
    }
  })

  control.register({
    id: 'clipboard.write',
    domain: 'clipboard',
    name: 'Copy to the clipboard',
    description: 'Puts text (and optionally HTML), or an image data URL, on the clipboard.',
    params: { text: str('Text to copy.', false, { sensitive: true }), html: str('HTML version.', false, { sensitive: true }), imageDataUrl: str('A data:image/… URL.') },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      if (typeof p.imageDataUrl === 'string') {
        const image = nativeImage.createFromDataURL(p.imageDataUrl)
        if (image.isEmpty()) fail('invalid-params', "That image couldn't be read.")
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
      } else if (typeof p.html === 'string') {
        await clipboard.write([new ClipboardItem({ 'text/html': p.html, ...(typeof p.text === 'string' ? { 'text/plain': p.text } : {}) })])
      } else if (typeof p.text === 'string') await clipboard.writeText(p.text)
      else fail('invalid-params', 'Give text, html or imageDataUrl.')
    },
    verify: async (_d, p) => {
      const ok =
        typeof p.imageDataUrl === 'string'
          ? (await clipboardTypes()).includes('image/png')
          : typeof p.text === 'string'
            ? (await clipboard.readText()) === p.text
            : (await clipboardTypes()).includes('text/html')
      return { verified: ok, detail: ok ? 'The clipboard holds it.' : "The clipboard doesn't hold it." }
    }
  })

  control.register({
    id: 'clipboard.clear',
    domain: 'clipboard',
    name: 'Clear the clipboard',
    description: 'Empties the clipboard.',
    params: {},
    mutates: true,
    confirmation: 'none',
    run: () => clipboard.clear(),
    verify: async () => {
      const types = await clipboardTypes()
      return { verified: types.length === 0 || (await clipboard.readText()) === '', detail: types.length ? `Still on the clipboard: ${types.join(', ')}.` : 'The clipboard is empty.' }
    }
  })


  // ---------------------------------------------------------------- state: snapshot, discovery, conditions, log

  control.registerState('browser', () => windowControl.state ?? { open: false })
  control.registerState('capabilities', () => {
    const list = control.list()
    return { total: list.length, available: list.filter((c) => c.available).length, domains: [...new Set(list.map((c) => c.domain))] }
  })
  control.registerState('automation', () => windowControl.listRuns().map((r) => ({ id: r.id, name: r.name, status: r.status, iteration: r.iteration, currentStep: r.currentStep })))

  control.register({
    id: 'state.snapshot',
    domain: 'state',
    name: 'Read browser state',
    description: `The real current state of Orbis, read now: ${control.stateParts().join(', ')} (and any parts registered later). Ask for only the parts needed.`,
    params: { parts: { type: 'array', description: 'Which parts (default: all).' } },
    mutates: false,
    confirmation: 'none',
    run: (p) => control.snapshot(p.parts as string[] | undefined)
  })

  control.register({
    id: 'state.capabilities',
    domain: 'state',
    name: 'What Orbis can do',
    description: 'Discovers the capabilities this Orbis exposes right now, with parameters, requirements, confirmation policy and availability; search by words or domain.',
    params: { query: str('Words to search for.'), domain: str('Only this domain.'), availableOnly: bool('Only those that can run now.') },
    mutates: false,
    confirmation: 'none',
    run: (p, ctx) => control.list({ query: p.query as string | undefined, domain: p.domain as string | undefined, availableOnly: p.availableOnly === true }, ctx.source)
  })

  control.register({
    id: 'state.log',
    domain: 'state',
    name: 'Control log',
    description: 'Recent structured log entries (observation, decision, command, execution, result, verification, error, recovery), with secrets redacted.',
    params: { limit: int('Default 100.'), capability: str('Only this capability.'), runId: str('Only this run.') },
    mutates: false,
    confirmation: 'none',
    run: (p) => control.recentLog(Number(p.limit) || 100, { capability: p.capability as string | undefined, runId: p.runId as string | undefined })
  })

  control.register({
    id: 'state.check',
    domain: 'state',
    name: 'Check a condition',
    description:
      'Evaluates a condition against real state now. { check: elementExists|elementMissing (locator, tabId?), textContains|textMissing (text, locator?, tabId?), urlMatches (pattern, tabId?), pageLoaded (tabId?), downloadCompleted (id? | match?), tabExists (tabId? | url? | title?), windowExists (id? | title?), extensionExists (id? | name?, enabled?), settingEquals (key, value), capabilityAvailable (id), compare (left, op, right) } or { all: [...] } / { any: [...] } / { not: ... }.',
    params: { condition: { type: 'object', description: 'The condition.', required: true } },
    mutates: false,
    confirmation: 'none',
    run: async (p, ctx) => ({ value: await evaluate(p.condition as Condition, ctx) })
  })

  /** Reads one of Chromium's own lists through the capability that provides it (downloads, windows, extensions). */
  const list = async (capability: string, ctx: ControlContext): Promise<Record<string, unknown>[]> => {
    const result = await control.execute({ capability, params: {}, source: ctx.source }, { source: ctx.source, confirm: async () => true })
    return result.ok && Array.isArray(result.data) ? (result.data as Record<string, unknown>[]) : []
  }
  const has = (row: Record<string, unknown>, key: string, wanted: unknown, partial = false): boolean => {
    if (wanted === undefined || wanted === null || wanted === '') return true
    const value = row[key]
    return partial ? String(value ?? '').toLowerCase().includes(String(wanted).toLowerCase()) : value === wanted || String(value) === String(wanted)
  }

  async function evaluate(condition: Condition, ctx: ControlContext): Promise<boolean> {
    if ('all' in condition) {
      for (const c of (condition as { all: Condition[] }).all) if (!(await evaluate(c, ctx))) return false
      return true
    }
    if ('any' in condition) {
      for (const c of (condition as { any: Condition[] }).any) if (await evaluate(c, ctx)) return true
      return false
    }
    if ('not' in condition) return !(await evaluate((condition as { not: Condition }).not, ctx))
    const c = condition as Record<string, unknown>
    const tabCtx = { target: c.tabId ? { tabId: String(c.tabId) } : ctx.target }
    const pageOf = (): PageHandle | null => {
      try {
        return d.resolvePage(tabCtx)
      } catch {
        return null
      }
    }
    switch (c.check) {
      case 'elementExists':
      case 'elementMissing': {
        const wc = pageOf()
        const found: { ref?: number } = wc ? await page.exec<{ ref?: number }>(wc, page.locateScript((c.locator ?? {}) as Locator), 5000).catch((): { ref?: number } => ({})) : {}
        return c.check === 'elementExists' ? Boolean(found.ref) : !found.ref
      }
      case 'textContains':
      case 'textMissing': {
        const wc = pageOf()
        if (!wc) return c.check === 'textMissing'
        const text = c.locator
          ? await page.exec<string>(wc, `(() => { const r = ${page.locateScript(c.locator as Locator)}; const el = r.ref && document.querySelector('[data-orbis-ref="' + r.ref + '"]'); return el ? (el.innerText || el.value || '') : ''; })()`, 5000).catch(() => '')
          : await page.exec<string>(wc, `document.body ? document.body.innerText : ''`, 5000).catch(() => '')
        const found = text.toLowerCase().includes(String(c.text ?? '').toLowerCase())
        return c.check === 'textContains' ? found : !found
      }
      case 'urlMatches': {
        const url = pageOf()?.getURL() ?? ''
        try {
          return new RegExp(String(c.pattern), 'i').test(url)
        } catch {
          return url.includes(String(c.pattern))
        }
      }
      case 'pageLoaded': {
        const wc = pageOf()
        return Boolean(wc && !wc.isLoading())
      }
      case 'downloadCompleted':
        return (await list('downloads.list', ctx)).some((x) => x.state === 'completed' && (!c.id || String(x.id) === String(c.id)) && (!c.match || `${String(x.filename)} ${String(x.url)}`.toLowerCase().includes(String(c.match).toLowerCase())))
      case 'tabExists':
        return Boolean(windowControl.state?.tabs.some((t) => (!c.tabId || t.id === c.tabId) && (!c.url || t.url.includes(String(c.url))) && (!c.title || t.title.toLowerCase().includes(String(c.title).toLowerCase()))))
      case 'windowExists':
        return (await list('window.list', ctx)).some((w) => has(w, 'id', c.id) && has(w, 'title', c.title, true))
      case 'extensionExists':
        return (await list('extensions.list', ctx)).some((e) => has(e, 'id', c.id) && has(e, 'name', c.name, true) && (typeof c.enabled !== 'boolean' || e.enabled === c.enabled))
      case 'settingEquals':
        return compare(readPath(await d.store.getSettings(), String(c.key)), '==', c.value)
      case 'capabilityAvailable':
        return control.describe(String(c.id), ctx.source)?.available === true
      case 'compare':
        return compare(c.left, String(c.op ?? '=='), c.right)
      default:
        return fail('invalid-params', `Unknown condition check "${String(c.check)}".`)
    }
  }
}
