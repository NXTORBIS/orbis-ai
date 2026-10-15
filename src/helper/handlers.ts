import type { ChatMessage, ReasoningEffort, StreamEvent } from '../shared/types'
import { currentModelId, DEFAULT_MODEL, MODELS } from '../shared/models.ts'
import { modelFor } from '../shared/providers.ts'
import { resolveModel } from '../shared/modelRoute.ts'
import { streamChat } from '../main/nim.ts'
import { generateWithContinuation } from '../main/longGeneration.ts'
import { runSearch } from '../main/search.ts'
import { endpointFromEnvironment, SearxngProvider } from '../main/search/specialized.ts'
import { answerContext, runResearch } from '../main/research.ts'
import { isSpecialized } from '../shared/searchProviders.ts'
import type { Research } from '../shared/types'
import { createAdblockHandlers } from './adblock/service.ts'
import { createPersonalHandlers, type PersonalDeps } from './personal.ts'
import { createRecallHandlers, type RecallHelperDeps } from './recall.ts'
import { createScheduleHandlers, type SchedulesHelperDeps } from './schedules.ts'
import { createSecretsHandlers } from './secrets.ts'
import { createStudentHandlers } from './student.ts'
import type { StudentHelperDeps } from './student.ts'
import { createTabLockHandlers } from './tabLock.ts'
import type { TabLockDeps } from './tabLock.ts'
import { createMarketsHandlers } from './markets.ts'
import type { MarketsHelperDeps } from './markets.ts'
import { createWidgetHandlers } from './widgets.ts'
import type { WidgetsDeps } from './widgets.ts'
import type { SecretsDeps } from './secrets.ts'
import { createWorkflowHandlers } from './workflows.ts'
import type { WorkflowsDeps } from './workflows.ts'
import { createConversationHandlers } from './conversations.ts'
import type { ConversationsDeps } from './conversations.ts'
import { createFaviconHandlers } from './favicons.ts'
import { createSearchSessionHandlers } from './searchSessions.ts'
import type { SearchSessionsDeps } from './searchSessions.ts'
import { createAppServiceHandlers } from './appServices.ts'
import type { AppServicesDeps } from './appServices.ts'
import { createGalaxyHandlers } from './galaxy.ts'
import type { GalaxyDeps } from './galaxy.ts'
import { createBrowserControlHandlers } from './browserControl.ts'
import { createBrowserTaskHandlers } from './browser/tasks.ts'
import { createOrionHandlers } from './orion.ts'
import { gatherContext } from '../main/context/engine.ts'
import { ambientProvider, capabilityProvider, eventsProvider, pageProvider, tabsProvider, timeProvider } from '../main/context/providers.ts'
import { bus } from '../main/eventBus.ts'
import { createMemoryHandlers, type MemoryDeps } from './memory.ts'
import { createSkillHandlers } from './skills.ts'
import { createTrayHandlers } from './tray.ts'
import { createSearchPageHandlers } from './searchPage.ts'
import { createOrbHandlers } from './orb/run.ts'
import { createVisualHandlers } from './visual.ts'
import { WidgetFeeds } from '../main/widgetFeeds.ts'
import { TrayStore } from '../main/personal/tray.ts'
import { createVoiceHandlers, type VoiceDeps } from './voice.ts'
import type { SkillManager } from '../main/skillManager.ts'
import type { BrowserHost } from './browser/host.ts'
import type { PanelControl } from './browserControl.ts'
import { createPanelStoreHandlers } from './panelStores.ts'
import { createMusicHandlers, type MusicPort } from './music.ts'
import { createOmniboxSuggestionHandlers } from './omniboxSuggestions.ts'
import type { PanelStores } from './panelStores.ts'
import { HelperError } from './server.ts'
import type { Handler } from './server.ts'

/**
 * The channels the helper answers.
 *
 * Each is the same thing Electron Orbis answers on `ipcMain`, run by the same code — nim.ts, longGeneration.ts and the
 * rest are already free of Electron — so a fix to one is a fix to both. This is the skeleton: the first real channels,
 * enough to prove the whole path (panel → token → helper → Orion → streamed answer) before the rest are moved over
 * one at a time.
 */

export interface HandlerDeps {
  /** The person's own Groq keys, given to the helper when it starts and never sent back to the panel. */
  apiKeys: string[]
  /**
   * Keys for the other service, used when the chosen model is one of theirs -- which is every model that can see.
   *
   * It began as a count, on the reasoning that the helper only needed to know whether anything could see. That was
   * wrong in the way that matters: the helper runs its own chat requests, so it needs the key to make one. A count
   * reached Mistral's address carrying a Groq key, was refused, and the Orb reported "nothing came back from looking
   * at the page" -- true, and silent about why.
   */
  mistralKeys?: string[]
  /** Overridable so tests never reach the network. */
  fetchFn?: typeof fetch
  version?: string
  /** Where the extension and the filter lists live, when the helper manages the ad blocker's lists. */
  /** This profile's own data folder for notes and tasks; without it those channels do not exist. */
  dataDir?: string
  /**
   * The app's own vault, workflow engine and Galaxy, when the helper runs inside Orbis. Each is read at call time (they may come
   * into being after the helper does); returning null answers the panel with "not ready". Without them those channels do not exist.
   */
  secrets?: () => SecretsDeps | null | undefined
  /**
   * Tab Lock, for the browser's lock surface.
   *
   * The surface is drawn by the browser and the password is held by Orbis, so the surface asks over the helper like any
   * other Orbis page. Absent when Orbis has no tab passwords yet, in which case the channels simply are not there.
   */
  tabLock?: () => TabLockDeps | null | undefined
  /**
   * What Orbis has worked out somebody is working on.
   *
   * Read at call time and allowed to be absent, like everything else here: with no Ambient Intelligence the
   * Context Engine simply assembles one source fewer, which is a gap rather than a failure.
   */
  ambient?: () => { forOrion(): Promise<{ text: string; label: string } | null> } | null | undefined
  /**
   * Orbis Student, for the browser.
   *
   * A short list on purpose: what is happening, keep this, start, stop. Nothing that reads the learning record and
   * nothing that can loosen a session's rules. Absent when Orbis is not running, and the browser then says so
   * instead of offering a button that quietly does nothing.
   */
  student?: () => StudentHelperDeps | null | undefined
  /**
   * Markets, for the strip along the bottom of the browser.
   *
   * Absent when Markets are not set up, in which case the channels simply are not there -- which is how the strip learns
   * there is nothing to show rather than being told a price of zero.
   */
  markets?: () => MarketsHelperDeps | null | undefined
  /**
   * The widgets on the browser's start page: the board, and what each widget shows.
   *
   * The widgets are kept with the rest of what is personal, in the Orbis window's own store, so the start page asks
   * for them here. Absent when Orbis is not running, and the page then says so plainly rather than drawing an empty
   * board that looks like an answer.
   */
  widgets?: () => WidgetsDeps | null | undefined
  workflows?: () => WorkflowsDeps | null | undefined
  galaxy?: () => GalaxyDeps | null | undefined
  /** The app's search-box suggestions and local speech to text, for the pages in the browser (search results); when given, those channels exist. */
  appServices?: () => AppServicesDeps | null | undefined
  /**
   * Orbis's own Pages, for the Pages tab in search.
   *
   * Given by the app, because the register is the app's: it holds the built-in Pages and whatever this profile has
   * built, and the helper has neither. Absent when Orbis is running as the browser alone, and the tab then finds
   * nothing -- which is the truth, rather than a tab that is missing for a reason nobody can see.
   */
  pages?: () => { search(query: string): Promise<{ title: string; url: string; snippet: string; site: string }[]> } | null | undefined
  /**
   * The things this person has made in Orbis: the "Made in Orbis" group in search.
   *
   * Given by the app, because the library is the app's. Absent when Orbis is running as the browser alone, and the
   * group is then simply not on the page -- which is the truth, rather than an empty group reading "you have made
   * nothing". Records only: no artifact's content ever crosses this.
   */
  artifacts?: () =>
    | {
        search(query: string): Promise<{ id: string; title: string; kind: string; summary: string; snippet: string }[]>
        open(artifactId: string): boolean
      }
    | null
    | undefined
  /** Saved Orion Search sessions: the app's own store when given, else the helper opens the same database under dataDir. */
  searchSessions?: SearchSessionsDeps['store']
  /** Chats: the app's own store when given, else the helper opens the same folder under dataDir. */
  conversations?: ConversationsDeps['store']
  /**
   * Notes and tasks: the app's own stores when given, never a second pair opened over the same files.
   *
   * Both the window and these handlers hold what they read in memory. Opening a second pair meant a task edited
   * in the browser panel was written to disk and the window went on showing the old one, and the window's next
   * save wrote its stale copy back over the change.
   */
  personal?: () => { notes: NonNullable<PersonalDeps['notes']>; tasks: NonNullable<PersonalDeps['tasks']> } | null
  /** What a person asked Orbis to remember: the app's own store, never a second connection to the same database. */
  memory?: MemoryDeps['store']
  /**
   * The pages this person has read: the app's own index, never a second one opened here.
   *
   * Two processes opening the same SQLite file is how a database gets locked at the worst moment, and the index is
   * written by the window's own capture. Absent when the browser is running alone, and the panel says so rather than
   * showing an empty list.
   */
  /**
   * How Orbis looks: the CSS variables the chat is wearing right now, and the backdrop its preset asked for.
   *
   * The browser and the chat are two halves of one application, so a theme or a preset chosen in one belongs in the
   * other. The map is built by `experienceVariables` in shared code -- the same function the chat uses -- so there is
   * one idea of what a preset means rather than two that drift.
   *
   * Read at call time, so a change in Settings reaches an open browser without a restart.
   */
  appearance?: () =>
    | Promise<{ variables: Record<string, string>; backdrop: string | null; field?: boolean; still?: boolean }>
    | { variables: Record<string, string>; backdrop: string | null; field?: boolean; still?: boolean }
    | null
    | undefined
  recall?: () => RecallHelperDeps['store'] | null | undefined
  /**
   * Schedules: the app's own store and scheduler, never a second one.
   *
   * Two stores would mean two answers to "what is scheduled", and the one somebody happened not to be looking at
   * would be the wrong one. Absent when the browser is running alone, and the panel says so rather than showing an
   * empty list -- an empty list reads as "you have none", which would be a lie.
   */
  schedules?: () => SchedulesHelperDeps | null | undefined
  /**
   * Who the person says they are. Orbis has no account and nothing to sign in to; this is the name they typed into the app,
   * and the browser shows it so the same person is named the same way on both sides. Read at call time so a rename in the
   * Orbis window reaches the browser without a restart. Only the name and the title: nothing else in settings comes through.
   */
  identity?: () => Promise<{ name: string; title: string } | null>
  /**
   * The browser's first-launch introduction: whether this installation has seen it, and a way to record that it has. It is
   * kept with the app's settings rather than in the browser profile, so switching or adding a profile does not replay it.
   */
  intro?: {
    seen: () => Promise<number>
    markSeen: (version: number) => Promise<void>
  }
  /**
   * Put the browser away and show the chat. Given only by the Orbis app, which is the only place there is a chat to
   * go back to: run on its own, Orbis is the browser and the channel does not exist.
   */
  showChat?: () => void
  /**
   * The browser the helper holds, when it holds one (src/helper/browser/host.ts). This is what makes Orbis able to act
   * on the browser rather than only talk about it: with it, the browser:task channels exist and the whole control layer
   * is reachable. Read at call time, because a browser can be closed and started again under a running helper.
   */
  browser?: () => BrowserHost | null | undefined
  /** The Browser Control Layer, for the rail's Tabs, Tab groups, Media and Controls rows; when given, the browser:* channels exist. */
  browserControl?: () => PanelControl | null | undefined
  /**
   * The stores behind the sidebar's saved pages, screenshots, clipboard, reminders, whiteboard, workspaces and sources rows, read at call
   * time. A store that is missing answers its channels with "not available" and nothing else.
   */
  stores?: () => PanelStores | null | undefined
  /** Orbis Music, lent at call time. Absent when the Orbis window is not running. */
  music?: () => MusicPort | null | undefined
  profileId?: string
  /**
   * The Orbis window, for the two Visual Search actions only it can do: carry a selection into the conversation, and
   * open a laboratory with what was read out of a picture. Absent when the window is not running, and those two are
   * then not offered at all rather than offered and failing.
   */
  /** Whether the person has Visual Search turned on. Absent outside Orbis, where it is treated as on. */
  visualOn?: () => Promise<boolean>
  visualWindow?: () =>
    | {
        toChat(input: { image: string; question: string; answer: string; title: string; page?: { title?: string; url?: string } }): Promise<void>
        toLab(input: { appId: string; data: Record<string, unknown>; title: string }): Promise<boolean>
      }
    | null
    | undefined
  adblock?: { extensionDir: string; listsDir: string; bundledDir: string }
  /**
   * How the built-in Orbis panel reaches the ad blocker's worker (a component of the browser, not reachable from a chrome:// page).
   * The app runs the operation in the worker; without it the channel does not exist.
   */
  adblockControl?: (message: { type: string; [key: string]: unknown }) => Promise<unknown>
  /**
   * Speech to text, done here rather than sent anywhere: whisper.cpp over a model on this machine. It needs to be told
   * where the binary is, which only whoever started the helper knows, so without this the voice channels do not exist.
   */
  voice?: () => VoiceDeps | null | undefined
  /**
   * The app's own skill library when the helper runs inside Orbis. Without it the helper opens the same files itself,
   * so skills work either way; what it cannot do without a data folder and a workflow engine is have any at all.
   */
  skills?: () => { manager: SkillManager } | null | undefined
}

const ROLES = new Set(['user', 'assistant'])
const MAX_MESSAGES = 200
const MAX_CONTENT = 400_000
const EFFORTS = new Set<ReasoningEffort>(['low', 'high', 'max'])

/** A conversation from the panel, checked: the panel is trusted with the token, not with the shape of what it sends. */
function readMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) throw new HelperError('bad-request', 'Expected a conversation of 1 to 200 messages.')
  return value.map((raw, i): ChatMessage => {
    const m = raw as Partial<ChatMessage> | null
    if (!m || typeof m !== 'object' || !ROLES.has(m.role as string) || typeof m.content !== 'string' || m.content.length > MAX_CONTENT) {
      throw new HelperError('bad-request', `Message ${i + 1} is not a valid message.`)
    }
    // Pictures come through. Without this a question about an image was answered from its words alone, because the
    // image was quietly dropped on the way in.
    const attachments = Array.isArray(m.attachments)
      ? m.attachments
          .filter((a) => a && typeof a === 'object' && typeof a.content === 'string' && (a.type === 'image' || a.type === 'text'))
          .slice(0, 4)
          .map((a) => ({ name: typeof a.name === 'string' ? a.name.slice(0, 200) : 'image', type: a.type, content: a.content.slice(0, 8_000_000), ...(typeof a.mimeType === 'string' ? { mimeType: a.mimeType.slice(0, 100) } : {}) }))
      : undefined
    return { id: typeof m.id === 'string' ? m.id.slice(0, 80) : `m${i}`, role: m.role as ChatMessage['role'], content: m.content, createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(), ...(attachments?.length ? { attachments } : {}) }
  })
}

const ADBLOCK_CONTROL = new Set(['adblock:state', 'adblock:settings', 'adblock:site', 'adblock:resource', 'adblock:remove-exception', 'adblock:reload-lists'])

function createAdblockControl(run: NonNullable<HandlerDeps['adblockControl']>): Handler {
  return ([message]) => {
    const m = message as { type?: unknown } | null
    if (!m || typeof m !== 'object' || typeof m.type !== 'string' || !ADBLOCK_CONTROL.has(m.type)) throw new HelperError('bad-request', 'Not an ad blocking operation.')
    return run(m as { type: string })
  }
}

/** One weather client, made when the first weather search happens and kept for the ones after it. */
let feeds: WidgetFeeds | null = null
const weatherFeeds = (fetchFn: typeof fetch, version: string): WidgetFeeds => {
  feeds ??= new WidgetFeeds({ fetch: fetchFn as never, appVersion: version })
  return feeds
}

const trays = new Map<string, TrayStore>()
/** The tray store for a data folder, made once. Kept here so a helper that never opens the tray never opens its file. */
function trayStore(dataDir: string): TrayStore {
  const held = trays.get(dataDir)
  if (held) return held
  const made = new TrayStore(dataDir)
  trays.set(dataDir, made)
  return made
}

/**
 * Notes and tasks, from the application's own stores when it is running.
 *
 * Lent rather than opened again: both copies hold what they read in memory, so a second pair meant a task edited
 * in the browser panel was written to disk and the window went on showing the old one. Opened here only when the
 * application is not running, which is the one case where there is no other copy to be out of step with.
 */
function personalHandlers(deps: HandlerDeps): Record<string, Handler> {
  const lent = deps.personal?.()
  if (lent) return createPersonalHandlers({ dataDir: deps.dataDir ?? '', notes: lent.notes, tasks: lent.tasks })
  return deps.dataDir ? createPersonalHandlers({ dataDir: deps.dataDir }) : {}
}

export function createHandlers(deps: HandlerDeps): Record<string, Handler> {
  const doFetch = (url: string, init?: RequestInit): Promise<Response> => (deps.fetchFn ?? fetch)(url, init)
  // Orbis Search is two providers: ordinary web search, and a specialized one for every other category. Neither can
  // break the other — a category that cannot be reached says so and web search carries on.
  const specialized = new SearxngProvider({ endpoint: endpointFromEnvironment(), fetchFn: doFetch })

  // Named, because the router below runs the task agent and the chat that are defined in this same object.
  // The view somebody asked the side panel to open (the new tab page's rail asks; the panel takes it when it shows).
  let panelWanted: { view: string; at: number } | null = null
  const handlers: Record<string, Handler> = {
    'panel:request': ([view]) => {
      if (typeof view !== 'string' || !/^[a-zA-Z]{1,24}$/.test(view)) throw new HelperError('bad-request', 'Not a panel view.')
      panelWanted = { view, at: Date.now() }
      return { ok: true }
    },
    'panel:take': () => {
      const want = panelWanted && Date.now() - panelWanted.at < 15_000 ? panelWanted.view : null
      panelWanted = null
      return { view: want }
    },
    ...createSearchSessionHandlers({ store: deps.searchSessions, userData: deps.dataDir, profileId: deps.profileId, apiKeys: deps.apiKeys, fetchFn: doFetch }),
    ...createFaviconHandlers({ fetchFn: doFetch }),
    ...createConversationHandlers({ store: deps.conversations, userData: deps.dataDir, profileId: deps.profileId }),
    ...personalHandlers(deps),
    ...createRecallHandlers(() => {
      // Read at call time, like the other stores here: the window may start after the browser has.
      const store = deps.recall?.()
      return store ? { store } : null
    }),
    ...createScheduleHandlers(() => deps.schedules?.()),
    /** How Orbis looks, for the browser's own pages. Nothing here changes anything: it reads what the chat is wearing. */
    ...(deps.appearance
      ? {
          'appearance:get': async () => (await deps.appearance!()) ?? { variables: {}, backdrop: null, field: false, still: false }
        }
      : {}),
    ...(deps.secrets ? createSecretsHandlers(deps.secrets) : {}),
    ...(deps.tabLock ? createTabLockHandlers(deps.tabLock) : {}),
    ...(deps.student ? createStudentHandlers(deps.student) : {}),
    ...(deps.markets ? createMarketsHandlers(deps.markets) : {}),
    ...(deps.widgets ? createWidgetHandlers(deps.widgets) : {}),
    ...(deps.workflows ? createWorkflowHandlers(deps.workflows) : {}),
    ...(deps.galaxy ? createGalaxyHandlers(deps.galaxy) : {}),
    ...(deps.appServices ? createAppServiceHandlers(deps.appServices) : {}),
    // What the browser's own address bar asks Orbis for. It needs both halves -- the app, for Orion's predictions and
    // for whether history may be used, and the panel's stores, for workspaces and saved research -- and this is the
    // one place that has both.
    ...createOmniboxSuggestionHandlers({
      stores: () => deps.stores?.(),
      orion: async (input) => (await deps.appServices?.()?.suggestOrion(input)) ?? [],
      personalized: async () => (await deps.appServices?.()?.personalizedSuggestions?.()) ?? true
    }),
    ...(deps.browser
      ? createBrowserTaskHandlers({
          host: () => deps.browser!(),
          apiKeys: deps.apiKeys,
          fetchFn: doFetch as unknown as typeof fetch,
          defaultModel: DEFAULT_MODEL
        })
      : {}),
    // Asking Orbis something, and Orbis choosing which of its own systems answers. It runs the task agent and the chat
    // that are already here rather than repeating either.
    ...(deps.apiKeys.length
      ? createOrionHandlers({
          apiKeys: deps.apiKeys,
          fetchFn: doFetch as unknown as typeof fetch,
          host: () => deps.browser?.(),
          runTask: async (request, ctx) => handlers['browser:task']([request], ctx),
          chat: async (request, ctx) => handlers['chat:send']([request], ctx),
          /**
           * The Context Engine, over the sources this side really has.
           *
           * The helper serves the browser's own pages, so it has the page, the tabs, the capability registry and the
           * event bus -- and not the task or note stores, which belong to the Orbis window. So those providers are not
           * listed, rather than listed and made to return nothing: a source Orbis does not have here is absent, and
           * absent is different from empty.
           */
          context: async (request, signal) => {
            const host = deps.browser?.()
            const control = () => (host && host.alive ? host.control : null)
            return gatherContext(
              { text: request.text, ...(deps.profileId ? { profileId: deps.profileId } : {}) },
              [
                timeProvider(),
                pageProvider(control),
                tabsProvider(control),
                capabilityProvider(control),
                eventsProvider(bus),
                // What all of the above is about, which is the one thing none of them can say.
                ambientProvider(() => deps.ambient?.() ?? null)
              ],
              { signal }
            )
          }
        })
      : {}),
    ...(deps.intro
      ? {
          'intro:get': async () => ({ seen: await deps.intro!.seen() }),
          'intro:seen': async ([version]: unknown[]) => {
            // Only a number this side recognises is recorded, so a page cannot mark a version that does not exist as done.
            const v = typeof version === 'number' && Number.isFinite(version) ? Math.max(0, Math.floor(version)) : 0
            await deps.intro!.markSeen(v)
            return true
          }
        }
      : {}),
    ...(deps.showChat ? { 'app:show-chat': () => (deps.showChat!(), { shown: true }) } : {}),
    ...(deps.artifacts
      ? {
          /** What you made that matches. Records only, capped by the app; an empty list means nothing matched. */
          'artifacts:search': async ([query]: unknown[]) => ({
            results: (await deps.artifacts!()?.search(typeof query === 'string' ? query.slice(0, 200) : '')) ?? []
          }),
          /** Brings Orbis forward with one of them open. One way: nothing but whether it was asked comes back. */
          'artifacts:open': ([artifactId]: unknown[]) => ({
            opened: deps.artifacts!()?.open(typeof artifactId === 'string' ? artifactId : '') ?? false
          })
        }
      : {}),
    ...(deps.identity
      ? {
          'identity:get': async () => {
            const who = await deps.identity!()
            return who ? { name: who.name, title: who.title } : null
          }
        }
      : {}),
    // The control layer, from whichever side has one: the app's when Orbis runs it, or the browser the helper
    // itself started. The rail's tabs and navigation rows and the Orb's reading of the page all come through here.
    ...(deps.browserControl || deps.browser
      ? createBrowserControlHandlers(() => deps.browserControl?.() ?? deps.browser?.()?.control ?? null)
      : {}),
    ...(deps.stores ? createPanelStoreHandlers(deps.stores) : {}),
    // Orbis Music, for the browser’s panel, its new-tab page and its mini-player. With the window closed each of
    // these says so rather than answering with an empty library.
    ...createMusicHandlers(() => deps.music?.()),
    // The Orb's control loop. It coordinates the systems above rather than repeating any of them: actions go through
    // the Browser Control Layer, questions through the same chat Auto Mode picks a model for, and everything else
    // through the channels already in this object.
    ...(deps.apiKeys.length
      ? createOrbHandlers({
          control: () => deps.browserControl?.() ?? deps.browser?.()?.control ?? null,
          has: (name) => Object.prototype.hasOwnProperty.call(handlers, name),
          channel: (name, args, ctx) => {
            const channel = handlers[name]
            if (!channel) throw new HelperError('unavailable', `This Orbis has no ${name}.`)
            return Promise.resolve(channel(args, ctx as never))
          },
          /** Which model can look at a page, from what this copy of Orbis actually has keys for. */
          eyes: () => modelFor('glance', { groq: deps.apiKeys.length > 0, mistral: (deps.mistralKeys ?? []).length > 0 }),
          ask: async (prompt, signal, options) => {
            let text = ''
            await handlers['chat:send'](
              [
                {
                  webSearch: false,
                  /*
                   * A picture needs a model that can see, and it has to be named.
                   *
                   * Left to the ordinary choice this went to Groq, where nothing on this account has eyes -- and the
                   * image was dropped on the way out rather than refused, so the answer came back confidently built
                   * from the page's text. Naming the model is what makes looking actually look.
                   */
                  ...(options?.model ? { model: options.model } : {}),
                  messages: [
                    {
                      role: 'user',
                      content: prompt,
                      ...(options?.image ? { attachments: [{ name: 'page.png', type: 'image', content: options.image, mimeType: 'image/png' }] } : {})
                    }
                  ]
                }
              ],
              {
                emit: (event: StreamEvent) => {
                  if (event.type === 'delta' && typeof event.content === 'string') text += event.content
                },
                signal
              }
            )
            return text
          }
        })
      : {}),
    /*
     * Orbis Visual Search: hold Ctrl, drag over anything on a page, ask Orion about it.
     *
     * Assembled from the channels already in this object rather than given its own anything. The picture goes to
     * `chat:send` with the vision model named, a search goes through the Browser Control Layer, keeping it goes to
     * the real Notes, and the two actions that need the window are handed to the window. What Visual Search can do at
     * any moment is whichever of those are actually present, which is why `visual:can` is asked every time instead of
     * being decided here.
     */
    ...createVisualHandlers(() => ({
      // Read every time rather than cached: the person may turn it off while the browser is open, and the next
      // selection must then find the gesture gone rather than find a button that refuses.
      on: async () => (deps.visualOn ? deps.visualOn() : Promise.resolve(true)),
      canSee: () => (deps.mistralKeys ?? []).length > 0,
      ask: async (input, on, signal) => {
        await handlers['chat:send'](
          [
            {
              webSearch: false,
              // Named, because left to the ordinary choice this went to the text service, where nothing can see, and
              // the picture was dropped on the way out rather than refused.
              model: input.model,
              messages: [
                {
                  role: 'user',
                  content: input.prompt,
                  attachments: [{ name: 'selection.png', type: 'image', content: input.image, mimeType: 'image/png' }]
                }
              ]
            }
          ],
          {
            emit: (event: StreamEvent) => {
              if (event.type === 'delta' && typeof event.content === 'string') on.chunk(event.content)
              else if (event.type === 'status' && typeof event.message === 'string') on.status(event.message)
            },
            signal
          }
        )
      },
      browser: () => {
        // The one gate: without the control layer there is no `browser:do`, so searching and opening are not offered.
        if (!Object.prototype.hasOwnProperty.call(handlers, 'browser:do')) return null
        const act = async (action: string, args: Record<string, unknown>): Promise<void> => {
          const reply = (await handlers['browser:do']([action, args], {} as never)) as { ok?: boolean; message?: string } | undefined
          if (reply && reply.ok === false) throw new HelperError('unavailable', reply.message ?? 'The browser would not do that.')
        }
        return {
          search: (query) => act('search', { query }),
          open: (url) => act('open', { url })
        }
      },
      notes: () => {
        if (!Object.prototype.hasOwnProperty.call(handlers, 'notes:create')) return null
        return {
          create: async (note) => {
            await handlers['notes:create']([{ title: note.title, body: note.body, tags: [] }], {} as never)
          }
        }
      },
      window: () => deps.visualWindow?.() ?? null
    })),
    // Voice, skills and memory: three things the Orb and the Command Center offer, which until now existed only in the
    // Electron app. None of them is a new system -- each is the same code the app runs -- but the browser could not
    // reach any of them, so the buttons for them led nowhere. These are the ways in.
    // Speech to text twice over would be a bug, not a fallback: the app's own service (appServices) and this one answer
    // the same three channels. When Orbis is running, its service is the one with the models and the person's settings,
    // so this exists only for the helper running on its own, where there is no app to ask.
    ...(deps.voice && !deps.appServices ? createVoiceHandlers(deps.voice) : {}),
    ...(deps.dataDir
      ? createMemoryHandlers({ userData: deps.dataDir, profileId: () => deps.profileId, ...(deps.memory ? { store: deps.memory } : {}) })
      : {}),
    /*
     * The comparison tray: search results pinned side by side, and compared from what their pages say.
     *
     * Gated on somewhere to keep the pins, and nothing else. It used to also require a model key, which had a
     * consequence worth spelling out: with no key the channels simply did not exist, so the pin button on every
     * result was offered, pressed, and answered with "Orbis could not change the tray just now" -- a control that
     * looks live and is not, which is the one thing this codebase tries hardest never to ship.
     *
     * Pinning, unpinning and listing need no model at all. Only the comparison does, and it says so itself when
     * asked without one.
     */
    ...(deps.dataDir
      ? createTrayHandlers({
          store: () => trayStore(deps.dataDir!),
          hasModel: () => deps.apiKeys.length > 0,
          fetchFn: doFetch as unknown as typeof fetch,
          ask: async (prompt, signal) => {
            let text = ''
            await handlers['chat:send'](
              [{ webSearch: false, messages: [{ role: 'user', content: prompt }] }],
              {
                emit: (event: StreamEvent) => {
                  if (event.type === 'delta' && typeof event.content === 'string') text += event.content
                },
                signal
              }
            )
            return text
          }
        })
      : {}),
    ...(deps.dataDir && deps.workflows
      ? createSkillHandlers({
          manager: () => deps.skills?.()?.manager,
          userData: deps.dataDir,
          profileId: deps.profileId,
          workflows: () => deps.workflows!(),
          // What the browser can do right now, asked of the browser. Null when there is no browser, which is the
          // honest answer: a skill cannot be checked against a browser that is not running.
          capabilities: () => deps.browser?.()?.control?.list() ?? null
        })
      : {}),
    ...(deps.adblockControl ? { 'adblock:control': createAdblockControl(deps.adblockControl) } : {}),
    ...(deps.adblock ? createAdblockHandlers({ ...deps.adblock, fetchFn: doFetch }) : {}),
    /** Whether the helper is there and the token works. Says nothing about the person's data. */
    'helper:ping': () => ({ ok: true, version: deps.version ?? 'dev', hasApiKey: deps.apiKeys.length > 0 }),

    /** The models Orion can use, from the one list Electron Orbis uses too, so the two can never disagree. */
    'models:list': () => ({ default: DEFAULT_MODEL, models: MODELS.map((m) => ({ id: m.id, label: m.label, description: m.description })) }),

    /** Orbis Search: the same two providers Electron Orbis uses, for the category the person picked. */
    'search:run': async ([query, vertical], { signal }) => {
      const words = typeof query === 'string' ? query.slice(0, 300) : ''
      const asked = typeof vertical === 'string' ? vertical : 'all'
      // Orbis's own Pages. Answered by the app when it is there, because only the app knows which Pages this profile
      // has built; with no app there are no user Pages to know about, and the tab says so rather than being absent.
      if (asked === 'pages') {
        const started = Date.now()
        const results = (await deps.pages?.()?.search(words)) ?? []
        return {
          query: words,
          vertical: 'pages',
          results,
          wantsAnswer: false,
          problem: results.length ? null : 'No Orbis Page does that yet.',
          tookMs: Date.now() - started
        }
      }
      if (isSpecialized(asked as never)) return specialized.search(asked as never, words)
      return runSearch({ query: words, vertical: 'all', fetchFn: doFetch, signal })
    },
    'search:specialized-health': () => specialized.check(),

    // The composed results page: one query understood, then only the sections that query earns, each filled from
    // something real. It reuses the searches above rather than opening a second way to search.
    ...(deps.apiKeys.length
      ? createSearchPageHandlers({
          fetchFn: doFetch as unknown as typeof fetch,
          // The same forecast service the weather widget uses (MET Norway), so a search and a widget can never
          // disagree about the weather, and neither of them is a sentence somebody generated.
          weather: async (place) => {
            const answer = await weatherFeeds(doFetch as unknown as typeof fetch, deps.version ?? 'dev').weather(place)
            return answer.ok ? answer.data : null
          },
          web: async (query, signal) => (await runSearch({ query, vertical: 'all', fetchFn: doFetch, signal })) as { results?: unknown[]; problem?: string },
          specialized: async (category, query) => (await specialized.search(category as never, query)) as { results?: unknown[]; problem?: string },
          ask: async (prompt, signal) => {
            let text = ''
            await handlers['chat:send'](
              [{ webSearch: false, messages: [{ role: 'user', content: prompt }] }],
              {
                emit: (event: StreamEvent) => {
                  if (event.type === 'delta' && typeof event.content === 'string') text += event.content
                },
                signal
              }
            )
            return text
          }
        })
      : {}),

    /**
     * Ask Orion. Streams the same events the Electron window receives (`start`, `delta`, `done`…) and ends with the
     * model that answered. A long request continues past one call's output limit exactly as it does in Electron.
     */
    'chat:send': async ([request], { emit, signal }) => {
      const req = (request ?? {}) as { model?: unknown; messages?: unknown; systemPrompt?: unknown; reasoningEffort?: unknown; webSearch?: unknown }
      if (deps.apiKeys.length === 0 && (deps.mistralKeys ?? []).length === 0) throw new HelperError('no-key', 'The helper has no API key.')
      const messages = readMessages(req.messages)
      const last = messages[messages.length - 1]
      if (last.role !== 'user') throw new HelperError('bad-request', 'The last message must be from the person.')

      // With web search on, Orion answers from real pages, read now, and says which page each claim came from. The
      // sources go to the panel first, so it can show them while the answer streams.
      let conversation = messages
      if (req.webSearch === true) {
        const research: Research = await runResearch({
          question: last.content,
          queries: [last.content.trim().slice(0, 200)],
          recency: 'any',
          fetchFn: doFetch,
          signal,
          onStatus: (message) => emit({ type: 'status', message })
        })
        if (signal.aborted) return { model: null, aborted: true }
        if (research.sources.length) {
          emit({ type: 'research', research })
          const context = answerContext({ research, earlier: undefined, browser: undefined, onScreen: undefined, pageText: null, includePage: false })
          // Kept inside the person's own message, so the sources sit right next to the question they answer.
          conversation = [...messages.slice(0, -1), { ...last, content: `${context}\n\nQuestion: ${last.content}` }]
        } else {
          emit({ type: 'status', message: `Couldn't get current sources: ${research.problem ?? 'nothing usable was found'}. Answering without them.` })
        }
      }

      const requested = currentModelId(typeof req.model === 'string' ? req.model : undefined)
      const route = resolveModel(requested, { text: last.content, attachmentChars: 0, turns: messages.length })
      const effort = EFFORTS.has(req.reasoningEffort as ReasoningEffort) ? (req.reasoningEffort as ReasoningEffort) : 'high'
      const systemPrompt = typeof req.systemPrompt === 'string' ? req.systemPrompt.slice(0, 20_000) : ''

      await generateWithContinuation({
        messages: conversation,
        emit: (event: StreamEvent) => emit(event),
        signal,
        runSegment: (segmentMessages, segmentEmit) =>
          streamChat({
            apiKeys: deps.apiKeys,
            // Routed by the model, exactly as the address is: a key belongs to one service, not to "the API".
            mistralKeys: deps.mistralKeys ?? [],
            model: route.model,
            messages: segmentMessages,
            systemPrompt,
            reasoningEffort: effort,
            autoFallback: true,
            signal,
            emit: segmentEmit,
            fetchFn: (url, init) => (deps.fetchFn ?? fetch)(url, init)
          })
      })
      return { model: route.model }
    }
  }

  return handlers
}
