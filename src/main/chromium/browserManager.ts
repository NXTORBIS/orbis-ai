import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserControl } from '../browserControl/registry.ts'
import { newToken } from '../../helper/auth.ts'
import { createHandlers } from '../../helper/handlers.ts'
import { createHelperServer } from '../../helper/server.ts'
import { AdblockInjector } from './adblockInjector.ts'
import { launchOrbisChromium } from './service.ts'
import type { ChromiumControl } from './service.ts'

/**
 * Orbis's browser: one Chromium per running Orbis, started when the browser is first needed and reached over a pipe.
 *
 * What happens when Orbis opens its browser:
 *  1. The Orbis extension is copied to a folder of Orbis's own, so the browser never runs the installed files and the local
 *     helper's connection details (a port and a one-time secret) can be written beside it, readable only by the extension.
 *  2. The Orbis helper (search, Orion, notes, tasks, filter lists) is started inside Orbis, on this computer's loopback address only.
 *     The Groq keys are handed to it here and go nowhere else.
 *  3. Chromium is started with this Orbis profile's own data folder, so profiles never share cookies, history or bookmarks, and
 *     the Browser Control Layer is connected to it and takes over the browser capabilities.
 */

export const ORBIS_EXTENSION_ID = 'gcaebckmlhiagfagcplpjmibhkhjljab'

export interface BrowserManagerOptions {
  /** The Chromium executable. */
  chrome: string
  /** The Orbis extension as shipped (source of the copy the browser runs). */
  extensionSource: string
  /** A folder Orbis owns for the browser: the extension copy, and a browser data folder per profile. */
  dataDir: string
  /** The Orbis profile in use now. */
  profileId(): string | Promise<string>
  /** The person's own Groq keys, read when the helper starts. */
  apiKeys(): string[]
  /** Where the ad blocker's bundled catalog lives, and where downloaded filter lists are kept. */
  adblockBundledDir: string
  adblockListsDir: string
  /** Where the browser's notes and tasks are kept for this profile. */
  personalDir(profileId: string): string
  /** The one Browser Control Layer of the app: Chromium fills it. */
  control?: BrowserControl
  saveDir?: string
  /** Extra command-line switches for the browser (tests use this to allow autoplay). */
  chromeArgs?: string[]
  /** The browser was closed (by the person, or a crash). Nothing restarts it by itself. */
  onClosed?(): void
}

interface Running {
  service: ChromiumControl
  helper: { close(): Promise<void> }
  injector: AdblockInjector
  profileId: string
}

/** Whether typed text is an address (open it) or something to search for (Orbis Search). */
export function looksLikeAddress(input: string): string | null {
  const text = input.trim()
  if (!text || /\s/.test(text)) return null
  if (/^https?:\/\//i.test(text)) return text
  if (/^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/.*)?$/i.test(text)) return `http://${text}`
  if (/^[^\s/]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(text)) return `https://${text}`
  return null
}

export class BrowserManager {
  private running: Promise<Running> | null = null
  private active: Running | null = null
  private readonly o: BrowserManagerOptions

  constructor(options: BrowserManagerOptions) {
    this.o = options
  }

  get isRunning(): boolean {
    return this.running !== null
  }

  /** The control on the browser while it is running, for code that must not start it (following tabs mid-task). */
  get current(): ChromiumControl | null {
    return this.active?.service ?? null
  }

  /** Starts the browser if it is not running, and returns the control on it. */
  async ensure(): Promise<ChromiumControl> {
    this.running ??= this.start()
      .then((r) => (this.active = r))
      .catch((err) => {
        this.running = null
        throw err
      })
    return (await this.running).service
  }

  private async start(): Promise<Running> {
    const profileId = await this.o.profileId()
    const extensionDir = join(this.o.dataDir, 'extension')
    await rm(extensionDir, { recursive: true, force: true })
    await mkdir(this.o.dataDir, { recursive: true })
    await cp(this.o.extensionSource, extensionDir, { recursive: true, filter: (source) => !/[\/](helper\.json|_metadata)$/.test(source) })

    const token = newToken()
    const server = createHelperServer({
      token,
      allowedOrigins: [`chrome-extension://${ORBIS_EXTENSION_ID}`],
      handlers: createHandlers({
        apiKeys: this.o.apiKeys(),
        dataDir: this.o.personalDir(profileId),
        adblock: { extensionDir, listsDir: this.o.adblockListsDir, bundledDir: this.o.adblockBundledDir }
      })
    })
    const { port } = await server.listen()
    await writeFile(join(extensionDir, 'helper.json'), JSON.stringify({ port, token, pid: process.pid, startedAt: Date.now() }), { encoding: 'utf8', mode: 0o600 })

    try {
      const service = await launchOrbisChromium({
        chrome: this.o.chrome,
        profileDir: join(this.o.dataDir, 'profiles', profileId, 'browser'),
        extensionDir,
        extensionId: ORBIS_EXTENSION_ID,
        urls: ['chrome://newtab'],
        control: this.o.control,
        saveDir: this.o.saveDir,
        args: this.o.chromeArgs,
        waitMs: 60_000,
        onClosed: () => {
          this.running = null
          this.active = null
          void server.close()
          this.o.onClosed?.()
        }
      })
      // The ad blocker's page scripts run before each page's own, from here (see adblockInjector.ts).
      const injector = new AdblockInjector({
        browser: service.browser,
        adblockDir: join(extensionDir, 'adblock'),
        readSettings: () => service.bridge.run("chrome.storage.local.get('orbis.adblock.settings').then((r) => r['orbis.adblock.settings'] ?? null)")
      })
      await injector.start()
      return { service, helper: server, injector, profileId }
    } catch (err) {
      await server.close()
      throw err
    }
  }

  /**
   * Shows something in the browser: an address opens as a page, anything else is searched with the browser's own default search
   * (Orbis Search). In a new tab when asked, or in the current one; `more` opens further pages in the background.
   */
  async open(input: string, options: { newTab?: boolean; more?: string[] } = {}): Promise<{ ok: boolean; detail: string }> {
    const service = await this.ensure()
    const exec = (capability: string, params: Record<string, unknown>) => service.control.execute({ capability, params, source: 'user' }, { confirm: async () => true })
    const text = input.trim()
    let result: { ok: boolean; error?: { message?: string } }
    if (!text) result = { ok: true }
    else {
      const url = looksLikeAddress(text)
      if (url) result = options.newTab === false ? await exec('navigation.go', { url }) : await exec('tabs.create', { url, active: true })
      else {
        await service.bridge.run(`chrome.search.query({ text: ${JSON.stringify(text)}, disposition: ${options.newTab === false ? "'CURRENT_TAB'" : "'NEW_TAB'"} })`)
        result = { ok: true }
      }
    }
    for (const extra of options.more ?? []) if (looksLikeAddress(extra)) await exec('tabs.create', { url: looksLikeAddress(extra), active: false })
    // Bring the browser to the front: opening a page from Orbis should show it.
    await service.bridge.run('chrome.windows.getAll().then((all) => all[0] && chrome.windows.update(all[0].id, { focused: true }))').catch(() => undefined)
    return { ok: result.ok, detail: result.ok ? (text ? 'Opened in the Orbis browser.' : 'The Orbis browser is open.') : (result.error?.message ?? 'The browser could not open that.') }
  }

  /** Call when profiles change: the browser belongs to one profile, so a switch closes it (the next use opens the new profile's own). */
  async profileMayHaveChanged(): Promise<void> {
    if (!this.active) return
    if ((await this.o.profileId()) !== this.active.profileId) await this.stop()
  }

  async stop(): Promise<void> {
    const running = await this.running?.catch(() => null)
    this.running = null
    this.active = null
    if (!running) return
    running.injector.stop()
    running.service.stop()
    await running.helper.close()
  }
}
