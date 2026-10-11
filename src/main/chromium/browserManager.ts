import { cp, mkdir, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import type { BrowserControl } from '../browserControl/registry.ts'
import { newToken } from '../../helper/auth.ts'
import { createHandlers } from '../../helper/handlers.ts'
import type { HandlerDeps } from '../../helper/handlers.ts'
import { createHelperServer } from '../../helper/server.ts'
import { AdblockInjector } from './adblockInjector.ts'
import { launchOrbisChromium } from './service.ts'
import type { ChromiumControl, ChromiumControlOptions } from './service.ts'

/**
 * Orbis's browser: one Chromium per running Orbis, started when the browser is first needed and reached over a pipe.
 *
 * What happens when Orbis opens its browser:
 *  1. The Orbis extension (the ad blocker) is copied to a folder of Orbis's own, so the browser never runs the installed files; the local
 *     helper's connection details (a port and a one-time secret) go to the built-in Orbis pages through the browser's command line, never to a file.
 *  2. The Orbis helper (search, Orion, notes, tasks, filter lists) is started inside Orbis, on this computer's loopback address only.
 *     The Groq keys are handed to it here and go nowhere else.
 *  3. Chromium is started with this Orbis profile's own data folder, so profiles never share cookies, history or bookmarks, and
 *     the Browser Control Layer is connected to it and takes over the browser capabilities.
 */

export const ORBIS_EXTENSION_ID = 'gcaebckmlhiagfagcplpjmibhkhjljab'
/** The built-in panel's origin. */
export const ORBIS_PANEL_ORIGIN = 'chrome://orbis'
/**
 * The built-in Orbis pages (panel, new tab page, search results, the Orb): the only web-facing origins the helper
 * answers.
 *
 * The Orb belongs here as much as any of them. Left out, every call it made came back 403 and it said "Orbis is not
 * running yet" while Orbis was running -- which took the Orb's assistant down with it, and the Chat button too, since
 * going back to the chat is a helper call like any other. The browser's own check had already been taught about the
 * Orb; this one had not, and a request has to pass both.
 */
// The lock surface is here for a sharper reason than the others: the password it takes is checked by Orbis, so a lock
// screen whose origin the helper refuses is a lock screen that can never open anything.
/*
 * Every Orbis page that talks to the helper.
 *
 * The helper answers nothing from an origin that is not here, and a page left out has no way to say so: the strip
 * was missing, so every request it made -- `helper:ping` included -- was refused, and its one sentence for a
 * request that does not come back is "Orbis not running". It said that for as long as it existed, while Orbis was
 * running and answering the panel in the same browser.
 *
 * `builtinOrigins.test.ts` checks this against the pages that really import the helper client.
 */
export const ORBIS_BUILTIN_ORIGINS = [
  ORBIS_PANEL_ORIGIN,
  'chrome://orbis-newtab',
  'chrome://orbis-search',
  'chrome://orbis-orb',
  'chrome://orbis-lock',
  'chrome://orbis-ticker'
]

/** The code the ad blocker's worker runs for one operation of the panel's Blocking tab. */
export function adblockCall(message: { type: string; [key: string]: unknown }): string {
  const j = (v: unknown): string => JSON.stringify(v ?? null)
  switch (message.type) {
    case 'adblock:state':
      return 'globalThis.__orbisAdblock.state()'
    case 'adblock:settings':
      return `globalThis.__orbisAdblock.settings(${j(message.update)})`
    case 'adblock:site':
      return `globalThis.__orbisAdblock.site(${j(String(message.host))}, ${message.allowed ? 'true' : 'false'})`
    case 'adblock:resource':
      return `globalThis.__orbisAdblock.resource(${j(String(message.url))})`
    case 'adblock:remove-exception':
      return `globalThis.__orbisAdblock.removeException(${message.kind === 'site' ? "'site'" : "'resource'"}, ${j(String(message.value))})`
    case 'adblock:reload-lists':
      return 'globalThis.__orbisAdblock.reloadLists()'
    default:
      throw new Error('Not an ad blocking operation.')
  }
}

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
  /** The other service's keys, for the models that can see. The helper makes its own requests, so it needs them. */
  mistralKeys?(): string[]
  /** Where the ad blocker's bundled catalog lives, and where downloaded filter lists are kept. */
  adblockBundledDir: string
  adblockListsDir: string
  /** Where the browser's notes and tasks are kept for this profile. */
  personalDir(profileId: string): string
  /**
   * The app's own vault, workflow engine (and recorder, if any) and Galaxy, for the side panel. Each is read when the panel calls, so
   * they may be created after the browser is. The panel gets names and progress from them, never a secret's value.
   */
  secrets?: HandlerDeps['secrets']
  /** Tab Lock, for the browser's own lock surface: it asks Orbis whether a password is right. */
  tabLockHelper?: HandlerDeps['tabLock']
  /** Orbis Student, for the browser: what is happening, keep this, start, stop. Nothing that reads the learning record. */
  student?: HandlerDeps['student']
  /** Markets, for the strip along the bottom of the browser. */
  marketsHelper?: HandlerDeps['markets']
  /** The widgets on the start page: the board, and what each widget shows. */
  widgets?: HandlerDeps['widgets']
  workflows?: HandlerDeps['workflows']
  /** The app's skill library, so a skill learned in Orbis is the same skill the browser can run. */
  skills?: HandlerDeps['skills']
  galaxy?: HandlerDeps['galaxy']
  /** The app's search-box suggestions and local speech to text, offered to the results page. */
  appServices?: HandlerDeps['appServices']
  /** Orbis's own Pages, for the Pages tab in the browser's search page. */
  pages?: HandlerDeps['pages']
  /** The app's own saved-research store, so the results page and the Orbis window share one instance. */
  searchSessions?: HandlerDeps['searchSessions']
  /** Notes and tasks: the application's own stores, never a second pair opened over the same files. */
  personal?: HandlerDeps['personal']
  /** Memory: the application's own, never a second connection to the same database. */
  memory?: HandlerDeps['memory']
  /** The pages this person has read, for the browser panel that searches them. */
  /** How Orbis looks, so the browser's pages wear the same theme and preset as the chat. */
  appearance?: HandlerDeps['appearance']
  recall?: HandlerDeps['recall']
  /** Schedules: the app's own store and scheduler, so the browser's panel shows the same ones the window does. */
  schedules?: HandlerDeps['schedules']
  conversations?: HandlerDeps['conversations']
  /** The app's own stores behind the sidebar's saved pages, screenshots, clipboard, reminders, whiteboard, workspaces and sources rows. */
  stores?: HandlerDeps['stores']
  /** Orbis Music: the library and the player, for the panel, the new tab page and the mini-player. */
  music?: HandlerDeps['music']
  /** The name the person gave themselves in the app, so the browser names them the same way. */
  identity?: HandlerDeps['identity']
  /** Put the browser away and show the chat: what the browser's own Chat button asks for. */
  showChat?: HandlerDeps['showChat']
  /** Whether the person has Orbis Visual Search turned on. */
  visualOn?: HandlerDeps['visualOn']
  /** The window, for the two Visual Search actions only it can do: the conversation, and a laboratory. */
  visualWindow?: HandlerDeps['visualWindow']
  /** The things this person has made, for the "Made in Orbis" group on the browser's search page. */
  artifacts?: HandlerDeps['artifacts']
  /** Whether this installation has seen the browser's first-launch introduction, and how to record that it has. */
  intro?: HandlerDeps['intro']
  /** The one Browser Control Layer of the app: Chromium fills it. */
  control?: BrowserControl
  /** Tab Lock: how a listing is redacted, and how the security layer is told what the browser's tabs are doing. */
  tabLock?: ChromiumControlOptions['tabLock']
  saveDir?: string
  clipboard?: { readText(): Promise<string> | string; hasImage(): Promise<boolean> | boolean }
  /** Extra command-line switches for the browser (tests use this to allow autoplay). */
  chromeArgs?: string[]
  /** The browser process started (its window follows a moment later). */
  onStarted?(pid: number): void
  /** The browser lives inside the Orbis window (no separate window to bring to the front). */
  embedded?: boolean
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

/**
 * The browser's sandbox needs its own program folder to be readable by sandboxed (app-container) processes. Chromium's installer
 * sets that; Orbis installs the browser itself, so it does the same for its own folder: read and run for "ALL RESTRICTED
 * APPLICATION PACKAGES" and "ALL APPLICATION PACKAGES", nothing more. Best effort and harmless to repeat.
 */
export async function allowSandboxToRead(chromeExe: string): Promise<void> {
  if (process.platform !== 'win32') return
  const dir = dirname(chromeExe)
  // Already granted (the usual case after the first start): reading one file's permissions is instant, the recursive grant is not.
  const has = await new Promise<boolean>((done) => execFile('icacls', [chromeExe], { windowsHide: true }, (_e, out) => done(/APPLICATION PACKAGES/i.test(String(out)))))
  if (has) return
  for (const sid of ['*S-1-15-2-2', '*S-1-15-2-1']) {
    await new Promise<void>((done) => execFile('icacls', [dir, '/grant', `${sid}:(OI)(CI)(RX)`, '/T', '/C', '/Q'], { windowsHide: true }, () => done()))
  }
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
    // Captured for the browser host below, whose `alive` getter must see the manager rather than its own literal.
    const self = this
    const extensionDir = join(this.o.dataDir, 'extension')
    await rm(extensionDir, { recursive: true, force: true })
    await mkdir(this.o.dataDir, { recursive: true })
    // Both separators. The class used to be `[\/]`, which is only a forward slash -- so on Windows, where the paths
    // this filter sees are backslashed, it matched nothing and a stale `helper.json` from a previous run was copied in
    // with the extension. A page reading it then talked to a port that had been dead for hours.
    await cp(this.o.extensionSource, extensionDir, { recursive: true, filter: (source) => !/[\\/](helper\.json|_metadata)$/.test(source) })

    const token = newToken()
    const devExtension = process.env.ORBIS_DEV_EXTENSION === '1'
    // The bridge to the ad blocker's worker exists once the browser is up; the panel's blocking tab calls through it.
    let bridge: { run(expression: string): Promise<unknown> } | null = null
    const server = createHelperServer({
      token,
      allowedOrigins: [`chrome-extension://${ORBIS_EXTENSION_ID}`, ...ORBIS_BUILTIN_ORIGINS],
      handlers: createHandlers({
        apiKeys: this.o.apiKeys(),
        mistralKeys: this.o.mistralKeys?.() ?? [],
        dataDir: this.o.personalDir(profileId),
        secrets: this.o.secrets,
        tabLock: this.o.tabLockHelper,
        student: this.o.student,
        markets: this.o.marketsHelper,
        widgets: this.o.widgets,
        workflows: this.o.workflows,
        skills: this.o.skills,
        galaxy: this.o.galaxy,
        appServices: this.o.appServices,
        pages: this.o.pages,
        searchSessions: this.o.searchSessions,
        personal: this.o.personal,
        memory: this.o.memory,
        appearance: this.o.appearance,
        recall: this.o.recall,
        schedules: this.o.schedules,
        conversations: this.o.conversations,
        identity: this.o.identity,
        showChat: this.o.showChat,
        visualOn: this.o.visualOn,
        visualWindow: this.o.visualWindow,
        artifacts: this.o.artifacts,
        intro: this.o.intro,
        stores: this.o.stores,
        music: this.o.music,
        browserControl: () => this.o.control ?? this.active?.service.control,
        /**
         * The browser itself, for the parts of Orbis that need more than the control layer.
         *
         * This was missing, and its absence is why the AI did nothing inside the browser. `createHandlers` registers
         * `browser:task` and `browser:task-ready` only when this is given, so without it the readiness call answered
         * 404 -- and the panel, which treats any failure there as "no helper at all", reported that Orbis was not
         * running while Orbis was in fact running and listening. Orion had the same hole from the other side: it was
         * handed `host()` of undefined, so it could not read the page it was looking at or act on it.
         *
         * The running service already is everything a host is; it had simply never been offered as one.
         */
        browser: () => {
          const service = this.active?.service
          if (!service) return null
          return {
            control: service.control,
            agent: service.agent,
            bridge: service.bridge,
            // The browser is alive exactly while this is the running one; `this.active` is cleared on close.
            get alive() {
              return self.active?.service === service
            },
            stop: () => service.stop()
          }
        },
        profileId,
        adblockControl: (message) => {
          if (!bridge) throw new Error('The browser is not ready yet.')
          return bridge.run(adblockCall(message))
        },
        adblock: { extensionDir, listsDir: this.o.adblockListsDir, bundledDir: this.o.adblockBundledDir }
      })
    })
    const { port } = await server.listen()
    // The built-in pages (chrome://orbis, chrome://orbis-newtab, chrome://orbis-search) get these from the browser's command line,
    // handed only to those three pages. Nothing is written to a file.

    try {
      await allowSandboxToRead(this.o.chrome)
      const service = await launchOrbisChromium({
        chrome: this.o.chrome,
        profileDir: join(this.o.dataDir, 'profiles', profileId, 'browser'),
        ...(devExtension ? { extensionDir } : {}),
        extensionId: ORBIS_EXTENSION_ID,
        urls: ['chrome://newtab'],
        // Embedded means the Orbis window is about to take this window into itself, so it is built out of sight.
        hidden: this.o.embedded === true,
        control: this.o.control,
        tabLock: this.o.tabLock,
        saveDir: this.o.saveDir,
        clipboard: this.o.clipboard,
        args: [`--orbis-helper-port=${port}`, `--orbis-helper-token=${token}`, `--orbis-extension-dir=${extensionDir}`, ...(this.o.chromeArgs ?? [])],
        waitMs: 60_000,
        onClosed: () => {
          this.running = null
          this.active = null
          void server.close()
          this.o.onClosed?.()
        }
      })
      if (service.process.pid) this.o.onStarted?.(service.process.pid)
      bridge = service.bridge

      /*
       * The extension is told how to reach the helper.
       *
       * The selection orb -- the one that appears when you select text on a page -- draws itself in the page but can
       * do nothing there; everything it offers is run by the extension's worker, which has to be able to call Orbis.
       * The built-in pages get the port and this run's secret from the browser itself (chrome.send('orbis.getHelper'),
       * answered only for them). An extension cannot ask that, so the app hands it over here, down the debugging pipe
       * it already holds.
       *
       * Session storage, deliberately: it lives in memory, it is cleared when the browser closes, and no page and no
       * other extension can read it. The token never touches disk and never appears in an address.
       *
       * Not fatal if it fails. The browser works without the orb; the orb says Orbis is not running, which is true.
       */
      await service.bridge
        .run(`chrome.storage.session.set({ 'orbis.helper': { port: ${port}, token: ${JSON.stringify(token)} } }).then(() => true)`)
        .catch(() => console.warn('[orbis] the selection orb could not be told how to reach Orbis; it will say Orbis is not running'))

      // The ad blocker's page scripts run before each page's own, from here (see adblockInjector.ts).
      const injector = new AdblockInjector({
        browser: service.browser,
        adblockDir: join(extensionDir, 'adblock'),
        readSettings: () => service.bridge.run("chrome.storage.local.get('orbis.adblock.settings').then((r) => r['orbis.adblock.settings'] ?? null)")
      })
      await injector.start()

      /*
       * The browser is not ready until it is protected.
       *
       * Measured: from the moment Chromium answers to the moment an advertising host is actually refused is about two
       * seconds, and nothing was waiting for it. The browser was handed back, a page was opened, and for that second
       * or so it fetched exactly what it was about to start blocking -- on every launch, warm profile or cold, because
       * the wait is the extension starting rather than anything being cached.
       *
       * So this asks the extension which rulesets are live, and does not return until one of them is. Not a delay
       * added for safety: the work was already happening, and this is Orbis stopping pretending it had finished.
       *
       * Bounded, and failure is not fatal. A browser that will not start because its blocker is slow is worse than a
       * browser that starts unprotected and says so -- but the default has to be the other way round.
       */
      const protectedAt = await this.waitForProtection(service.bridge)
      if (protectedAt === null) console.warn('[orbis] the ad blocker did not confirm it was active; the browser is starting anyway')

      return { service, helper: server, injector, profileId }
    } catch (err) {
      await server.close()
      throw err
    }
  }

  /**
   * Waits until the ad blocker's network rules are actually enforcing, and says how long it took.
   *
   * Asked of the extension rather than assumed from the manifest: a ruleset is declared enabled and then has to be
   * indexed before it bites, and "declared" is not "enforcing". `getEnabledRulesets` answers with the ones Chromium
   * has finished loading, which is the only honest signal available.
   *
   * Returns null if it never confirms. The caller carries on -- a browser that refuses to open because its blocker is
   * slow would be a worse product than one that opens a moment later.
   */
  private async waitForProtection(bridge: { run<T>(expression: string): Promise<T> }, ms = 8000): Promise<number | null> {
    const started = Date.now()
    const end = started + ms
    while (Date.now() < end) {
      const live = await bridge
        .run<string[]>('chrome.declarativeNetRequest.getEnabledRulesets()')
        .catch(() => null)
      // Any ruleset at all: the first-line one is the point, and it is the first to finish indexing.
      if (Array.isArray(live) && live.length > 0) return Date.now() - started
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return null
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
    if (!this.o.embedded) await service.bridge.run('chrome.windows.getAll().then((all) => all[0] && chrome.windows.update(all[0].id, { focused: true }))').catch(() => undefined)
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
