import type { ParamSpec } from '../../shared/browserControl.ts'
import { fail } from '../browserControl/registry.ts'
import type { ChromiumCapabilityDeps } from './chromiumCapabilities.ts'
import type { CdpPage } from './cdpPage.ts'

/**
 * The rest of what the Electron browser's capabilities did that still has meaning on Chromium: copying from the page, reading its
 * console and network, its navigation details, and the ad blocker's settings (which live in the Orbis extension). The developer-tools window
 * and address bar are operated with real key input in chromiumCapabilities5.ts.
 */

const str = (description: string, required = false): ParamSpec => ({ type: 'string', description, required })
const bool = (description: string, required = false): ParamSpec => ({ type: 'boolean', description, required })
const int = (description: string, required = false): ParamSpec => ({ type: 'integer', description, required })
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface MoreDeps extends ChromiumCapabilityDeps {
  activePage(): Promise<CdpPage>
  /** Reads the system clipboard (the app's; a test may pass its own). */
  readClipboardText(): Promise<string>
  hasClipboardImage(): Promise<boolean>
}

type ConsoleEntry = { level: string; message: string; source: string; line: number; at: number }

export function registerBrowserToolCapabilities(d: MoreDeps): void {
  const { control, bridge } = d
  const json = (v: unknown): string => JSON.stringify(v)
  const adblock = <T>(call: string): Promise<T> => bridge.run<T>(`globalThis.__orbisAdblock.${call}`)

  // ---------------------------------------------------------------- the clipboard, from the page

  control.register({
    id: 'clipboard.copyFromPage',
    domain: 'clipboard',
    name: "Copy the page's selection",
    description: 'Copies what is selected in the tab, as Ctrl+C does.',
    params: {},
    mutates: true,
    confirmation: 'none',
    observe: async () => String(await (await d.activePage()).executeJavaScript('String(getSelection())')),
    run: async (_p, _ctx, selection) => {
      if (!String(selection).trim()) fail('invalid-params', 'Nothing is selected on the page. Select text first (page.selectText).', true)
      const page = await d.activePage()
      // The page's own copy command, run as if the person pressed it: the browser puts the selection on the clipboard.
      const done = await page.executeJavaScript(`document.execCommand('copy')`, true)
      if (done !== true) fail('unavailable', 'The page did not allow copying.', true)
    },
    verify: async (_d, _p, _ctx, selection) => {
      const norm = (t: string): string => t.replace(/\s+/g, ' ').trim()
      const end = Date.now() + 1500
      let copied = await d.readClipboardText()
      while (norm(copied) !== norm(String(selection)) && Date.now() < end) {
        await sleep(100)
        copied = await d.readClipboardText()
      }
      const ok = norm(copied) === norm(String(selection))
      return { verified: ok, detail: ok ? `Copied ${String(selection).length} characters.` : 'The clipboard does not hold the selection.' }
    }
  })

  control.register({
    id: 'clipboard.copyImageFromPage',
    domain: 'clipboard',
    name: 'Copy an image from the page',
    description: 'Copies an image on the page to the clipboard, as "Copy image" does.',
    params: { selector: str('CSS selector of the image (default: the first image).') },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const page = await d.activePage()
      const selector = typeof p.selector === 'string' && p.selector ? p.selector : 'img'
      const outcome = await page.executeJavaScript(
        `(async () => {
          const img = document.querySelector(${json(selector)});
          if (!img || !img.naturalWidth) return 'no-image';
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          return 'ok';
        })().catch((e) => 'failed: ' + e.message)`,
        true
      )
      if (outcome === 'no-image') fail('not-found', 'No loaded image matches that selector.', true)
      if (outcome !== 'ok') fail('unavailable', `The image could not be copied (${String(outcome)}).`, true)
    },
    verify: async () => {
      const end = Date.now() + 3000
      let ok = await d.hasClipboardImage()
      while (!ok && Date.now() < end) {
        await sleep(150)
        ok = await d.hasClipboardImage()
      }
      return { verified: ok, detail: ok ? 'The image is on the clipboard.' : 'No image was copied.' }
    }
  })

  // ---------------------------------------------------------------- console and network, from the browser's own protocol

  const consoles = new Map<CdpPage, { entries: ConsoleEntry[]; stop(): void }>()
  control.register({
    id: 'devtools.consoleCapture',
    domain: 'devtools',
    name: 'Capture console messages',
    description: "Starts (or stops) recording the tab's console messages; read them with devtools.console. Nothing is recorded until this is turned on.",
    params: { on: bool('true to start, false to stop.', true) },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const page = await d.activePage()
      const existing = consoles.get(page)
      if (!p.on) {
        existing?.stop()
        consoles.delete(page)
        return { capturing: false }
      }
      if (existing) return { capturing: true }
      const entries: ConsoleEntry[] = []
      const off = page.onEvent((event) => {
        const params = event.params as Record<string, any>
        if (event.method === 'Runtime.consoleAPICalled') {
          const message = (params.args ?? []).map((a: { value?: unknown; description?: string }) => (a.value !== undefined ? String(a.value) : (a.description ?? ''))).join(' ')
          const frame = params.stackTrace?.callFrames?.[0]
          entries.push({ level: String(params.type), message: message.slice(0, 2000), source: String(frame?.url ?? ''), line: Number(frame?.lineNumber) || 0, at: Date.now() })
        } else if (event.method === 'Runtime.exceptionThrown') {
          const x = params.exceptionDetails
          entries.push({ level: 'error', message: String(x?.exception?.description ?? x?.text ?? '').slice(0, 2000), source: String(x?.url ?? ''), line: Number(x?.lineNumber) || 0, at: Date.now() })
        } else return
        if (entries.length > 500) entries.splice(0, entries.length - 400)
      })
      await page.debugger.sendCommand('Runtime.enable')
      consoles.set(page, { entries, stop: off })
      return { capturing: true }
    },
    verify: async (_d, p) => {
      const on = consoles.has(await d.activePage())
      return { verified: on === p.on, detail: on ? 'Recording console messages.' : 'Not recording.' }
    }
  })

  control.register({
    id: 'devtools.console',
    domain: 'devtools',
    name: 'Read console messages',
    description: 'The console messages recorded since devtools.consoleCapture was turned on.',
    params: { limit: int('Most recent messages (default 100).'), level: str('Only this level (e.g. error, warning).') },
    mutates: false,
    confirmation: 'none',
    run: async (p) => {
      const buffer = consoles.get(await d.activePage()) ?? fail('unavailable', 'Console capture is off for this tab. Turn it on with devtools.consoleCapture first.', true)
      return buffer.entries.filter((e) => !p.level || e.level.toLowerCase().includes(String(p.level).toLowerCase())).slice(-(Number(p.limit) || 100))
    }
  })

  control.register({
    id: 'devtools.network',
    domain: 'devtools',
    name: 'Record network activity',
    description: "Records the tab's network requests for a few seconds (optionally reloading first) and lists them: URL, method, type, status, size, failures.",
    params: { durationMs: int('How long to record (default 5000, up to 30000).'), reload: bool('Reload the page when recording starts.') },
    mutates: false,
    confirmation: 'none',
    run: async (p, ctx) => {
      const page = await d.activePage()
      const requests = new Map<string, { url: string; method: string; type?: string; status?: number; mime?: string; bytes?: number; failed?: string; startedAt: number }>()
      const off = page.onEvent((event) => {
        const params = event.params as Record<string, any>
        const id = String(params.requestId ?? '')
        if (event.method === 'Network.requestWillBeSent' && requests.size < 1000) requests.set(id, { url: String(params.request.url).slice(0, 500), method: params.request.method, type: params.type, startedAt: Date.now() })
        else if (event.method === 'Network.responseReceived') Object.assign(requests.get(id) ?? {}, { status: params.response.status, mime: params.response.mimeType })
        else if (event.method === 'Network.loadingFinished') Object.assign(requests.get(id) ?? {}, { bytes: Number(params.encodedDataLength) || 0 })
        else if (event.method === 'Network.loadingFailed') Object.assign(requests.get(id) ?? {}, { failed: String(params.errorText ?? 'failed') })
      })
      try {
        await page.debugger.sendCommand('Network.enable')
        if (p.reload) await page.debugger.sendCommand('Page.reload')
        const end = Date.now() + Math.min(Number(p.durationMs) || 5000, 30_000)
        while (Date.now() < end && !ctx.signal?.aborted) await sleep(200)
      } finally {
        off()
        await page.debugger.sendCommand('Network.disable').catch(() => undefined)
      }
      return { count: requests.size, requests: [...requests.values()] }
    }
  })

  // ---------------------------------------------------------------- navigation details

  control.register({
    id: 'navigation.info',
    domain: 'navigation',
    name: "A tab's navigation details",
    description: "The tab's URL, title, whether it is loading, and its back/forward history.",
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => {
      const page = await d.activePage()
      const history = (await page.debugger.sendCommand('Page.getNavigationHistory')) as { currentIndex: number; entries: { url: string; title: string }[] }
      return {
        url: page.getURL(),
        title: page.getTitle(),
        loading: page.isLoading(),
        canGoBack: history.currentIndex > 0,
        canGoForward: history.currentIndex < history.entries.length - 1,
        entries: history.entries.slice(-20).map((e) => ({ url: e.url, title: e.title })),
        currentIndex: history.currentIndex
      }
    }
  })

  // ---------------------------------------------------------------- the ad blocker's settings (kept in the Orbis extension)

  type AdState = { settings: { enabled: boolean; level: string; siteExceptions: string[] } }
  const readAdblock = (): Promise<AdState> => adblock<AdState>('state()')

  control.register({
    id: 'settings.adblock',
    domain: 'settings',
    name: 'Read ad blocking',
    description: 'Ad blocking: on/off, strength, categories, site and resource exceptions, filter lists.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: readAdblock
  })

  control.register({
    id: 'settings.setAdblock',
    domain: 'settings',
    name: 'Change ad blocking',
    description: 'Turns ad blocking on or off or changes its strength (standard, strict, custom). Turning it off or weakening it is a security change, so Orbis asks first.',
    params: { enabled: bool('On or off.'), level: { type: 'string', description: 'standard, strict or custom', enum: ['standard', 'strict', 'custom'] } },
    mutates: true,
    confirmation: 'when-consequential',
    describe: (p) => (p.enabled === false ? 'Turn ad blocking off' : `Change ad blocking to ${JSON.stringify(p)}`),
    assess: async (p) => {
      const current = (await readAdblock()).settings
      const weaker = p.enabled === false || (p.level === 'standard' && current.level === 'strict') || p.level === 'custom'
      return weaker ? { decision: 'confirm', reason: 'This lowers protection against ads and trackers.' } : { decision: 'run', reason: '' }
    },
    run: async (p) => {
      const update: Record<string, unknown> = {}
      if (typeof p.enabled === 'boolean') update.enabled = p.enabled
      if (typeof p.level === 'string') update.level = p.level
      if (!Object.keys(update).length) fail('invalid-params', 'Give enabled or level.')
      return ((await adblock<AdState>(`settings(${json(update)})`)).settings)
    },
    verify: async (_d, p) => {
      const s = (await readAdblock()).settings
      const ok = (typeof p.enabled !== 'boolean' || s.enabled === p.enabled) && (typeof p.level !== 'string' || s.level === p.level)
      return { verified: ok, detail: `Ad blocking is ${s.enabled ? 'on' : 'off'} (${s.level}).` }
    }
  })

  control.register({
    id: 'settings.adblockSite',
    domain: 'settings',
    name: 'Allow or block ads on a site',
    description: 'Adds or removes a site exception: ads are allowed on that site (true) or blocked again (false).',
    params: { host: str('The site host, e.g. example.com.', true), allowed: bool('true to allow ads there.', true) },
    mutates: true,
    confirmation: 'none',
    run: async (p) => (await adblock<AdState>(`site(${json(String(p.host))}, ${p.allowed === true})`)).settings.siteExceptions,
    verify: async (_d, p) => {
      const host = String(p.host).toLowerCase().replace(/^www\./, '')
      const listed = (await readAdblock()).settings.siteExceptions.some((h) => h === host || h === String(p.host))
      return { verified: listed === (p.allowed === true), detail: listed ? `Ads are allowed on ${String(p.host)}.` : `Ads are blocked on ${String(p.host)}.` }
    }
  })
}
