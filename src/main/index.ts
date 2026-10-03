import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, powerMonitor, protocol, shell, Tray } from 'electron'
import type { MenuItemConstructorOptions, OpenDialogOptions, TitleBarOverlayOptions, IpcMainInvokeEvent } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import type {
  AutomationState,
  BrowserConfirmation,
  ChatMessage,
  ChatRequest,
  Conversation,
  ImageEditRequest,
  ImageEditResult,
  PickedFiles,
  Research,
  SettingsUpdate,
  StreamEvent
} from '../shared/types'
import { IMAGE_GEN_STATUS } from '../shared/types'
import { requestBodyFor, streamChat, testApiKey } from './nim'
import { cannotDo, keyFor, modelFor, PROVIDERS, refusalKind } from '../shared/providers'
import { generateWithContinuation } from './longGeneration.ts'
import { buildSystemPrompt } from './prompt'
import { UpdateManager } from './update/manager'
import { electronPlatform, imageSize } from './platformElectron'
import type { PageHandle } from './pageHandle'
import { runSearch } from './search'
import { endpointFromEnvironment, SearxngProvider } from './search/specialized'
import { isSpecialized } from '../shared/searchProviders'
import type { Platform } from './platform'
import { answerContext, runResearch } from './research'
import { adblockCommand } from './adblockChat'
import { BrowserLibrary } from './browserLibrary'
import { createWidgetRuntime } from './widgets/runtime'
import { createWidgetData } from './widgets/data'
import type { WidgetDataApi, WidgetRuntimeApi } from './widgets/contract'
import { registerLibraryIpc } from './libraryIpc'
import { registerBrowserExtras } from './browserCapabilities'
import { SearchWatcher } from './browserSearches'
import { openWorkspaceScript } from './browserWorkspace'
import type { WorkspaceGroupWanted, WorkspaceTabWanted } from './browserWorkspace'
import { mirrorChromiumInto } from './browserMirror'
import { RecallStore } from './knowledge/recall.ts'
import { registerRecallIpc } from './knowledge/recallIpc.ts'
import type { DeviceState } from '../shared/temporal/capability.ts'
import { TemporalEngine } from './temporal/engine.ts'
import { registerTemporalIpc } from './temporal/ipc.ts'
import { makeRunners } from './temporal/runners.ts'
import { TemporalStore } from './temporal/store.ts'
import { earliestWake, shouldStayAlive } from './temporal/wake.ts'
import { applyWake, clearWake, wakeIsPossible } from './temporal/windowsWake.ts'
import { hibernateNow } from './temporal/powerRead.ts'
import { postWebhook, sendTelegram, TELEGRAM_SECRET } from './temporal/telegram.ts'
import { FrontTabWatch, shouldReadNow } from './knowledge/recallCapture.ts'
import { MAX_PAGE_TEXT, pageKey, recallPromptBlock } from '../shared/recall.ts'
import { closedBrowserState, followChromiumTabs } from './browserState'
import type { ChromiumControl } from './chromium/service'
import type { BrowserManagerOptions } from './chromium/browserManager'
import { findSource, latestResearch, sourceNotes } from '../shared/research'
import { detectImageGenRequest, generateImage, rewriteImagePrompt } from './imagegen'
import { classifyAutomationMessage, classifyIntent } from './intent'
import type { ChatIntent } from './intent'
import { automationProgress } from '../shared/automation'
import { runBrowserAgent } from './browserAgent'
import { PulsarService, LocalVoiceError } from './pulsar/service.ts'
import type { PulsarDownloadProgress } from '../shared/pulsarModels.ts'
import { openDefaultAppsSettings, readDefaultBrowser, requestDefaultBrowser } from './defaultBrowser'
import { checkAudio, describeError, isVoiceModel } from '../shared/voiceInput'
import { completeDraft, generateTitle, generateWorkflowTitle, predictQueries, requestJson, suggestFollowups } from './suggest'
import { WorkflowTitler } from './workflows/titler'
import { parseWebSuggestions } from '../shared/omnibox'
import { fetchFavicon } from './favicon'
import { setupBrowserControl } from './browserControl/setup'
import { BrowserManager } from './chromium/browserManager'
import { EmbedController, parseRegion } from './chromium/embedController'
import { findBrowserWindow, standaloneWindow, type Standalone } from './chromium/embed'
import { embedSupported, hwndFromHandle } from './chromium/embed'
import { readSignals } from './browserControl/captchaCapabilities'
import { StepRun } from './stepRunner'
import { SkillManager } from './skillManager'
import { resolveModel } from '../shared/modelRoute'
import { planCompression, summarise, summaryBlock } from './compress'
import { parseSchedule, scheduleRequest } from '../shared/schedulePhrase'
import { MemoryFull, MemoryRefused, MemoryStore } from './knowledge/memory'
import { SearchSessionStore } from './knowledge/searchSessions'
import type { AppServicesDeps } from '../helper/appServices'
import type { PanelStores } from '../helper/panelStores'
import { GalaxyService } from './knowledge/galaxyService'
import { projectsMentioned } from '../shared/workspaces'
import type { GalaxyNodeType, GalaxyView } from '../shared/galaxy'
import type { Workflow, WorkflowStep } from '../shared/workflows'
import { memoryFromRequest, memoryPromptBlock, parseMemoryCommand } from '../shared/memory'
import type { MemoryCategory } from '../shared/memory'
import type { SkillEdits } from './skillManager'
import { planNextStep } from './stepPlanner'
import { WidgetFeeds } from './widgetFeeds'
import { WorkflowStore } from './workflows/store'
import { ChromiumRecorder } from './workflows/chromiumRecorder'
import type { RecorderCore } from './workflows/recorderCore'
import { WorkflowEngine } from './workflows/engine'
import { registerWorkflowIpc } from './workflows/ipc'
import { askOrion, draftValidatedWorkflow } from './workflows/orion'
import { looksLikeScheduleRequest, readRequest } from '../shared/temporal/phrase.ts'
import type { WorkflowIssue } from '../shared/workflows'
import { NotesStore } from './personal/notes'
import { TasksStore } from './personal/tasks'
import { ClipboardHistory } from './personal/clipboard'
import { WhiteboardStore } from './personal/whiteboard'
import { WorkspacesStore } from './personal/workspaces'
import { ProfilesStore } from './personal/profiles'
import { ExperienceStore } from './experience/store'
import { createNotifications, type Notifications } from './notifications/index'
import { bus } from './eventBus'
import { activePreset, appearanceVariables, wantsReducedMotion } from '../shared/experience'
import { presetBackdrop } from '../shared/presets'
import { RuleWatcher, workflowReadings } from './ruleWatcher'
import { AccountFailure, AccountSecurity } from './accountSecurity'
import { TabLockStore } from './tabLockStore'
import { registerTabLockIpc } from './tabLock/ipc'
import { registerProfileLockIpc } from './profileLock/ipc'
import { registerSecurityCapabilities } from './browserControl/securityCapabilities'
import { registerMarketCapabilities } from './browserControl/marketCapabilities'
import { SecurityLog } from './securityLog'
import { MarketEngine } from './markets/engine'
import { MarketsStore } from './markets/store'
import { MarketsRuntime } from './markets/runtime'
import { BinanceProvider } from './markets/providers/binance'
import { BinanceFuturesProvider } from './markets/providers/binanceFutures'
import { registerMarketsIpc } from './markets/ipc'
import { registerPortableIpc } from './portable/ipc'
import { PagesStore } from './pages/store'
import { PagesService } from './pages/service'
import { registerPagesIpc } from './pages/ipc'
import { pageResults } from '../shared/pages/search'
import { createSearchService } from '../search-service/server'
import type { RunningService } from '../search-service/server'

/**
 * The Pages tab's way into the register.
 *
 * A holder rather than a direct call because `search:run` is registered while the window is being set up and the
 * Pages service is built later. Null until then, and the tab says the register is not ready rather than reporting
 * that no Page matched -- which would be a different answer to a different question.
 */
let searchOrbisPages: ((query: string) => Promise<{ title: string; url: string; snippet: string; site: string }[]>) | null = null
import { GeneratedPages } from './pages/generated'
import { PageHost, PAGE_SCHEME_PRIVILEGES, setKnownOperations } from './pages/host'
import { CodePages } from './pages/codePages'
import { CodeStore } from './pages/codeStore'
import { ArtifactStore } from './artifacts/store'
import { ArtifactService } from './artifacts/service'
import { ArtifactGeneration } from './artifacts/generation'
import { ArtifactChat, type ArtifactChatTurn } from './artifacts/chat'
import { searchArtifacts } from './artifacts/searching'
import { isArtifactId, type ArtifactRecord } from '../shared/artifacts/model'
import { mediaFileName, mediaFromDataUrl, mediaIn, verifyMedia } from './artifacts/media'
import { READ_FOR_CHAT, isReadForChat, nameToOpenAs, readForChat } from './artifacts/attaching'
import { IMPORT_LIMITS } from './artifacts/importing'
import { chooseDestinationWith, chooseSourceWith, downloadsDirWith, registerArtifactsIpc, renderPdfWith, renderPngWith, revealWith } from './artifacts/ipc'
import { GeneratedStore } from './pages/generatedStore'
import { OPERATION_CAPABILITIES } from './pages/service'
import { FxRates } from './markets/fx'
import { pushLock } from './chromium/tabLockBridge'
import { registerExperienceIpc } from './experience/ipc'
import type { Profile } from '../shared/profiles'
import { registerPersonalIpc } from './personal/ipc'
import { BrowserSidebarStore } from './browserSidebarStore'
import { SecretsVault, VaultFailure } from './vault/store'
import { secretsFromVault } from '../helper/secrets'
import type { SecretsDeps } from '../helper/secrets'
import { Store } from './store'

// Baked in at build time from GROQ_API_KEY in .env.local (see electron.vite.config.ts).
declare const __GROQ_API_KEYS__: string[]
const GROQ_API_KEYS: string[] = typeof __GROQ_API_KEYS__ === 'undefined' ? [] : __GROQ_API_KEYS__

/*
 * Mistral's keys, the same way, for the jobs Groq cannot do.
 *
 * Kept as its own list rather than merged with the one above. A key sent to the wrong service is not a slow key or a
 * busy key -- it is an authentication failure, and one mixed into a rotation would look like the service being
 * unreliable rather than like a request sent to the wrong address.
 *
 * Empty when nobody has put a key in `.env.local`, and that is a working state: everything that needs Mistral says it
 * cannot rather than failing (shared/providers.ts, `cannotDo`).
 */
declare const __MISTRAL_API_KEYS__: string[]
const MISTRAL_API_KEYS: string[] = typeof __MISTRAL_API_KEYS__ === 'undefined' ? [] : __MISTRAL_API_KEYS__

/** Which services Orbis can actually reach, for choosing a model by job. */
export const HAVE_KEYS = { groq: GROQ_API_KEYS.length > 0, mistral: MISTRAL_API_KEYS.length > 0 }

/** Which key the next picture goes with. Rotated per request: requests per second is the limit that bites. */
let sightTurn = 0

/**
 * One picture and one instruction, answered in words.
 *
 * There is no "picture in, words out" call anywhere else in Orbis: the only route to a model that can see is a chat
 * completion with the picture as an attachment, so that is what this is -- one non-streaming request to Mistral, the
 * only service with eyes, on the 'look' ladder. A failure comes back as a sentence in the words the rest of Orbis
 * uses for a service that refused, never as empty words that would read as "the page was blank".
 *
 * Used by one thing: reading the pictures of a scanned PDF's pages, and only after the person has said so.
 */
async function seePicture(picture: { bytes: Uint8Array; mediaType: string }, instruction: string): Promise<{ words: string } | { failed: string }> {
  const chosen = modelFor('look', HAVE_KEYS)
  if (!chosen) return { failed: cannotDo('look', HAVE_KEYS) ?? 'Nothing on this computer can read a picture.' }
  const key = keyFor(MISTRAL_API_KEYS, sightTurn++)
  if (!key) return { failed: 'There is no Mistral key set, so nothing can read a picture.' }
  const url = `data:${picture.mediaType};base64,${Buffer.from(picture.bytes).toString('base64')}`
  let response: Response
  try {
    response = await net.fetch(`${PROVIDERS.mistral.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(
        requestBodyFor(chosen.model, {
          model: chosen.model,
          max_completion_tokens: 1200,
          temperature: 0,
          messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }, { type: 'text', text: instruction }] }]
        })
      )
    })
  } catch (err) {
    return { failed: `the picture could not be sent (${err instanceof Error ? err.message.slice(0, 120) : 'no connection'})` }
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const kind = refusalKind(response.status, body)
    return {
      failed:
        kind === 'busy'
          ? 'the service is busy and would not take another picture just now'
          : kind === 'bad-key'
            ? 'the Mistral key in your settings was not accepted'
            : kind === 'not-allowed'
              ? 'the Mistral key in your settings is not allowed to use the model that reads pictures'
              : `the service answered with ${response.status}`
    }
  }
  const json = (await response.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null
  const content = json?.choices?.[0]?.message?.content
  const words = typeof content === 'string' ? content : Array.isArray(content) ? content.map((one) => (typeof one === 'object' && one !== null && 'text' in one ? String((one as { text: unknown }).text) : '')).join('') : ''
  return words.trim() === '' ? { failed: 'nothing came back' } : { words }
}

/** What a message asks for beyond a text reply: /imagine, /browse, or a picture or browser task recognised from its meaning. */
async function detectIntent(messages: ChatMessage[], browser: ChatRequest['browser']): Promise<ChatIntent | null> {
  const text = messages.at(-1)?.content.trim() ?? ''
  if (text.startsWith('/imagine ')) {
    const prompt = text.slice('/imagine '.length).trim()
    return prompt ? { kind: 'image', prompt } : null
  }
  const automation = latestAutomation(messages)
  const context = automation ? { objective: automation.objective, status: automation.status, progress: automationProgress(automation) } : undefined
  const classify = (list: ChatMessage[]): Promise<ChatIntent | null | undefined> =>
    classifyIntent(list, browser, context, GROQ_API_KEYS, (url, init) => net.fetch(url, init), researchNote(messages, browser))
  if (text.startsWith('/browse ')) {
    const task = text.slice('/browse '.length).trim()
    if (!task) return null
    // The command already says "use the browser"; the classifier still works out whether it's a loop or a game.
    const verdict = await classify([...messages.slice(0, -1), { ...messages[messages.length - 1], content: task }])
    return verdict?.kind === 'browse' ? verdict : { kind: 'browse', task, mode: 'once', resume: false }
  }
  const verdict = await classify(messages)
  if (verdict !== undefined) return verdict
  // Groq couldn't be asked, so plainly worded requests such as "draw a dragon" still work.
  const phrase = detectImageGenRequest(text)
  if (phrase) return { kind: 'image', prompt: phrase }
  // Likewise, a clearly time-sensitive question still gets current sources.
  return FRESHNESS.test(text) ? { kind: 'answer', research: { queries: [text.slice(0, 200)], recency: 'any' }, usePage: false } : null
}

const FRESHNESS = /\b(latest|newest|current(ly)?|recent(ly)?|today|yesterday|tonight|this (week|month|year)|right now|as of now|breaking|just (released|announced|launched)|up-?to-?date|news)\b/i

/** The chat's latest research in one line for the intent classifier, including whether the open page is one of its sources. */
function researchNote(messages: ChatMessage[], browser: ChatRequest['browser']): string | undefined {
  const shown = browser ? findSource(messages, browser.url) : undefined
  const research = shown?.research ?? latestResearch(messages)
  if (!research) return undefined
  // Addresses included, so a browser task like "open source 2" can name the exact page.
  const sources = research.sources.map((s) => `[${s.n}] ${s.title.slice(0, 70)} <${s.url}>`).join('; ')
  return `"${research.question.slice(0, 160)}"; sources: ${sources}${shown ? `. The open browser page is source [${shown.source.n}].` : ''}`
}

/** The visible text of the Orbis browser (Chromium) tab showing `url`, for questions about the open page. */
async function readOpenPage(url: string): Promise<string | null> {
  const service = chromiumBrowser?.current
  const tab = service?.agent.windowControl.state.tabs.find((t) => t.url === url && t.webContentsId !== undefined)
  const page = tab?.webContentsId !== undefined ? service?.agent.findPage(tab.webContentsId) : null
  if (!page) return null
  try {
    const text = await Promise.race([
      page.executeJavaScript('document.body ? document.body.innerText : ""') as Promise<unknown>,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), 4000))
    ])
    return String(text).replace(/\n{3,}/g, '\n\n').trim().slice(0, 7000) || null
  } catch {
    return null
  }
}

/** The active tab of the Orbis browser (Chromium) when it is running and showing a web page. */
function openBrowserPage(): { url: string; title: string } | undefined {
  const tab = chromiumBrowser?.current?.agent.windowControl.state.tabs.find((t) => t.active && /^https?:\/\//i.test(t.url))
  return tab ? { url: tab.url, title: tab.title } : undefined
}

/** The conversation's most recent browser automation, which "continue" and "keep going" refer to. */
function latestAutomation(messages: ChatMessage[]): AutomationState | undefined {
  return [...messages].reverse().find((m) => m.role === 'assistant' && m.automation)?.automation
}

/** Speech to text: one Pulsar model manager and runtime for every microphone in Orbis; set up when the app is ready. */
let Pulsar: PulsarService | null = null
/** The app's own browsing library: new-tab shortcuts, address-bar memory, reading list, and a copy of Chromium's history, bookmarks and downloads. */
let browserLibrary: BrowserLibrary | null = null
/**
 * The widgets on the browser's start page.
 *
 * Set once the stores they read exist, and read at call time, because the browser is created before them -- a start
 * page opened in that moment says Orbis is still starting rather than drawing an empty board.
 */
let widgetsForBrowser: { runtime: WidgetRuntimeApi; data: WidgetDataApi } | null = null
/** The Orbis Browser Control Layer: every browser capability, for the window, Orion and automations. */
let browserControl: ReturnType<typeof setupBrowserControl> | null = null
/** Orbis's browser: Chromium, started when the browser is first needed. Null only when no Chromium build is installed. */
let chromiumBrowser: BrowserManager | null = null
/** Puts Chromium's window inside the Orbis window (Windows), over the renderer's browser view. */
const embedController = new EmbedController(() => (mainWindow && !mainWindow.isDestroyed() ? hwndFromHandle(mainWindow.getNativeWindowHandle()) : null))
/**
 * The browser is its own window, not a panel inside this one.
 *
 * Embedded, Chromium *is* the Orbis window while it is showing, so there is no arrangement where both are visible and
 * "go back to the chat" means covering one with the other. As two real windows they can sit side by side, each has its
 * own taskbar button, and going back is putting one away rather than hiding it behind the other.
 *
 * Embedding is kept behind an environment variable rather than deleted: it is the fallback for a machine where the
 * native window calls are unavailable, and it is how this behaved for a long time.
 */
const embeddedBrowser = process.platform === 'win32' && process.env.ORBIS_BROWSER_WINDOW === 'embedded' && embedSupported()

/**
 * Whether this launch opens straight into the browser, with no chat window shown.
 *
 * Read from the saved settings before any window is made, because the decision has to be taken before the chat is
 * shown rather than after it has already appeared.
 */
let startInBrowser = false

/** The browser's own window, while it is running. Null before it starts and after it closes. */
let browserWindow: Standalone | null = null

/**
 * Shows the browser and puts the chat away, or the other way round.
 *
 * Only ever hides. A closed browser loses every tab, and going back to the chat for a moment is not a request to throw
 * away what was open. The Orbis window is hidden rather than minimised for the same reason: it comes back exactly as
 * it was, in one step.
 */
function showBrowserWindow(show: boolean): void {
  if (browserWindow) browserWindow.setVisible(show)
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (show) mainWindow.hide()
  else {
    mainWindow.show()
    mainWindow.focus()
  }
}
/** Records workflows from what the user does (only while recording). */
let workflowRecorder: RecorderCore | null = null
/** Memory for the profile in use; created once the profiles are known. */
let memory: MemoryStore | null = null
let recall: RecallStore | null = null
/** The workflow engine, once it exists, so chat can schedule workflows in words. */
let workflowEngine: WorkflowEngine | null = null
/** Schedules, once they exist, so a schedule said in chat is kept rather than only talked about. */
let schedulesForChat: { store: TemporalStore; engine: TemporalEngine; profileId: () => string } | null = null
/** The two settings the browser's own pages need in order to look like the chat. Nothing else crosses. */
let settingsForBrowser: { effects: boolean } | null = null
/**
 * Orbis running with no window, for schedules.
 *
 * Only set when somebody has asked for it and something is actually scheduled, and always with a tray icon -- Orbis
 * is never left running invisibly with no way to stop it.
 */
let stayingAlive: { tray: Tray | null; because: string } | null = null
/** Works out again whether to keep running and whether to ask for a wake. Set once the scheduler exists. */
let reconsiderStaying: (() => Promise<void>) | null = null
/** Galaxy and the workspaces store, once they exist, so chat can give Orion a project's outline when it is named. */
let galaxyForChat: GalaxyService | null = null
/** The secrets vault, once it exists, for the Chromium side panel (which never receives a value). */
let vaultForPanel: SecretsDeps | null = null
/** What the Chromium side panel's Workflows tab needs beyond the engine: remembered secrets and Orion drafts. */
let workflowExtrasForPanel: { store: WorkflowStore; draft(instruction: string, current: Workflow | null): Promise<{ workflow: Workflow; issues: WorkflowIssue[] }> } | null = null
let workspacesForChat: WorkspacesStore | null = null
/**
 * The Creation Engine, once it exists, so that asking for a file in the chat makes one. Null until then, and the chat
 * treats null as "answer in words", the way it does for memory and schedules.
 */
let artifactsForChat: { service: ArtifactService; chat: ArtifactChat; profileId: () => Promise<string> } | null = null
/** The app's search-box suggestions and local speech to text, lent to the pages in the Orbis browser. */
let appServicesForBrowser: AppServicesDeps | null = null
/** The sidebar arrangement store, for the sidebar inside the built-in Orbis pages of the browser. */
let browserSidebarForBrowser: BrowserSidebarStore | null = null
/** Saved Orion Search research, once it exists: the results page in the browser and the Orbis window share this one store. */
let searchSessionsForBrowser: SearchSessionStore | null = null
/** The stores behind the Orbis panel's saved pages, screenshots, clipboard, reminders, whiteboard, workspaces and sources rows (set once they exist). */
let panelStoresForBrowser: PanelStores | null = null

/** Instructions the user adds to a running automation, per chat request. */
const automationInstructions = new Map<string, string[]>()

/** Browser actions waiting for the user's approval, keyed by request and confirmation. */
const browserConfirmations = new Map<string, (approved: boolean) => void>()

/** Shows an approval card in the chat and waits for the user's answer. */
function requestBrowserConfirmation(
  requestId: string,
  confirmation: BrowserConfirmation,
  emit: (event: StreamEvent) => void,
  signal: AbortSignal
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const key = `${requestId}:${confirmation.id}`
    const onAbort = (): void => {
      browserConfirmations.delete(key)
      reject(new Error('Stopped.'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    browserConfirmations.set(key, (approved) => {
      browserConfirmations.delete(key)
      signal.removeEventListener('abort', onAbort)
      emit({ type: 'confirm-done', id: confirmation.id })
      resolve(approved)
    })
    emit({ type: 'confirm', confirmation })
  })
}

/** Said when a browser task needs Orbis's browser but no Chromium build is installed. */
/**
 * Trims the strip Pollinations may mark, using the image support Electron has. The helper has none and asks for an
 * untrimmed image instead (src/main/imagegen.ts).
 */
const cropWatermark = (jpeg: Buffer, strip: number): string => {
  const image = nativeImage.createFromBuffer(jpeg)
  const { width, height } = image.getSize()
  if (image.isEmpty() || width === 0) throw new Error('Pollinations returned an unreadable image')
  const keep = Math.max(1, height - Math.round((strip * height) / (1024 + strip)))
  return `data:image/jpeg;base64,${image.crop({ x: 0, y: 0, width, height: keep }).toJPEG(92).toString('base64')}`
}

const NO_BROWSER = 'The Orbis browser (Chromium) is not installed on this computer.'

/** Orbis's browser, told each time it (re)starts so the app can follow its tabs. */
class FollowedBrowser extends BrowserManager {
  private followed: ChromiumControl | null = null
  private readonly onService: (service: ChromiumControl) => void
  private readonly onStopped: () => void
  constructor(options: BrowserManagerOptions, onService: (service: ChromiumControl) => void, onStopped: () => void) {
    super(options)
    this.onService = onService
    this.onStopped = onStopped
  }
  override async stop(): Promise<void> {
    await super.stop()
    this.followed = null
    this.onStopped()
  }
  override async open(input: string, options: { newTab?: boolean; more?: string[] } = {}): Promise<{ ok: boolean; detail: string }> {
    // Whoever opens the browser (the sidebar, Orion, a link), the Orbis window switches to its browser view.
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('chromium:show')
    return super.open(input, options)
  }
  override async ensure(): Promise<ChromiumControl> {
    const service = await super.ensure()
    if (service !== this.followed) {
      this.followed = service
      this.onService(service)
    }
    return service
  }
}

const MAX_ATTACHMENT_BYTES = 200_000
const TEXT_EXTENSIONS = [
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'xml', 'yaml', 'yml', 'toml', 'ini', 'env',
  'html', 'css', 'scss', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'java', 'c', 'cpp', 'h', 'hpp',
  'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'sql', 'sh', 'ps1', 'bat'
]

function titleBarOverlayFor(dark: boolean): TitleBarOverlayOptions {
  return dark ? { color: '#030304', symbolColor: '#a2a6ae', height: 36 } : { color: '#e6edf8', symbolColor: '#34507a', height: 36 }
}

let lastCpuTimes = cpuTimes()

function cpuTimes(): { idle: number; total: number } {
  let idle = 0
  let total = 0
  for (const { times } of os.cpus()) {
    idle += times.idle
    total += times.user + times.nice + times.sys + times.idle + times.irq
  }
  return { idle, total }
}

/** Load since the previous call, so the UI polling interval sets the sampling window. */
function sampleCpuUsage(): number {
  const now = cpuTimes()
  const idle = now.idle - lastCpuTimes.idle
  const total = now.total - lastCpuTimes.total
  lastCpuTimes = now
  return total > 0 ? Math.round((1 - idle / total) * 100) : 0
}

async function readTextFiles(paths: string[]): Promise<PickedFiles> {
  const picked: PickedFiles = { attachments: [], skipped: [], notes: [] }
  for (const path of paths.slice(0, 10)) {
    const name = basename(path)
    try {
      // An Excel, Word or PDF file is read by the same readers the Create screen opens files with, and attached as
      // the rows or the words it holds. What could not be carried across is said, not left to be discovered.
      if (isReadForChat(name)) {
        if ((await fs.stat(path)).size > IMPORT_LIMITS.bytes) {
          picked.notes?.push(`${name} is larger than the ${IMPORT_LIMITS.bytes / (1024 * 1024)} MB Orbis reads at once, so it was not attached.`)
          continue
        }
        const read = await readForChat(name, new Uint8Array(await fs.readFile(path)), MAX_ATTACHMENT_BYTES)
        if ('error' in read) picked.notes?.push(`${name} was not attached: ${read.message}`)
        else {
          picked.attachments.push({ name, content: read.content, type: 'text', mimeType: read.mimeType })
          picked.notes?.push(`${name}: ${read.notes.join(' ')}`)
        }
        continue
      }
      if ((await fs.stat(path)).size > MAX_ATTACHMENT_BYTES) {
        picked.skipped.push(name)
        continue
      }
      const buffer = await fs.readFile(path)
      // NUL bytes mean a binary file, which the model can't read as text.
      if (buffer.includes(0)) picked.skipped.push(name)
      else picked.attachments.push({ name, content: buffer.toString('utf8'), type: 'text' })
    } catch {
      picked.skipped.push(name)
    }
  }
  return picked
}

async function readImages(paths: string[]): Promise<PickedFiles> {
  const picked: PickedFiles = { attachments: [], skipped: [] }
  for (const path of paths.slice(0, 10)) {
    const name = basename(path)
    try {
      if ((await fs.stat(path)).size > MAX_ATTACHMENT_BYTES) {
        picked.skipped.push(name)
        continue
      }
      const buffer = await fs.readFile(path)
      const base64 = buffer.toString('base64')
      const ext = name.split('.').pop()?.toLowerCase()
      const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp'
      picked.attachments.push({ name, content: base64, type: 'image', mimeType })
    } catch {
      picked.skipped.push(name)
    }
  }
  return picked
}

const activeRequests = new Map<string, AbortController>()
let store: Store
let mainWindow: BrowserWindow | null = null
/**
 * The person's experience settings, once they have been read.
 *
 * Held here because things that interrupt -- a finished workflow, a rule coming true -- happen long after startup and
 * need to know whether the person asked not to be interrupted.
 */
let experienceStore: ExperienceStore | null = null
/**
 * The one place in Orbis that interrupts somebody.
 *
 * Everything that finishes, fails or waits publishes a fact to this; nothing else in Orbis touches the operating
 * system's notifications. Held at module level because the things that report to it -- a workflow ending, a schedule
 * running, a rule becoming true -- happen long after the startup that built it.
 */
let notifications: Notifications | null = null
/** Whose notifications these are. Kept in step with the profile, so one profile's never reach another's screen. */
let notifyProfileId = 'default'
/**
 * What the window last said it was showing.
 *
 * Used for one thing only: not announcing what is already on the screen. Null means Orbis does not know, and not
 * knowing means it says the thing -- being told twice is a smaller fault than not being told at all.
 */
let watchingNow: string | null = null
let ruleWatcher: RuleWatcher | null = null

function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Orbis's own icon, for builds that are not packaged.
 *
 * A path handed to Electron is loaded quietly: if Windows cannot make an icon of it, nothing is reported and the
 * window keeps Electron's atom. That is what happened here -- the file was 832x1248, and Windows will not build an
 * icon from an image that is not square. Loading it here means an unusable icon is a thing this function can see.
 *
 * Windows is given the .ico, which carries every size the shell asks for; everywhere else takes the PNG.
 */
function orbisIcon(): Electron.NativeImage | undefined {
  const dir = join(app.getAppPath(), 'build')
  for (const name of process.platform === 'win32' ? ['icon.ico', 'icon.png'] : ['icon.png']) {
    const image = nativeImage.createFromPath(join(dir, name))
    if (!image.isEmpty()) return image
  }
  return undefined
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 720,
    minHeight: 500,
    title: 'Orbis',
    // Packaged builds take their icon from the executable; unpackaged ones get it here, or they wear Electron's.
    ...(app.isPackaged ? {} : { icon: orbisIcon() }),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#e6edf8',
    // The HUD's own system bar replaces the native title bar; window buttons are overlaid on it.
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlayFor(nativeTheme.shouldUseDarkColors),
    // The File/Edit/View/Help row stays out of the way (Alt shows it); its shortcuts keep working.
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      webviewTag: false
    }
  })

  /**
   * Shown when it is ready -- unless this launch is meant to be the browser.
   *
   * "Open browser on launch" used to be answered in the renderer, which meant the chat window appeared, drew itself,
   * and was then covered. As its own window the browser can simply be what opens, and the chat is created but left
   * hidden until somebody asks for it. It still exists, so returning to it is instant rather than a cold start.
   */
  win.once('ready-to-show', () => {
    if (startInBrowser) return
    /*
     * A development run that must not take the screen. The window is shown, so it draws exactly as it really does,
     * but it is not brought to the front, is not given the keyboard, and is placed where it covers nothing. This is
     * for checks that drive the window from outside while somebody is working on the same computer: a window that
     * appears over their work and takes their typing is a way of controlling their machine, and they did not ask for
     * it. Never in a packaged Orbis.
     */
    if (!app.isPackaged && process.env.ORBIS_QUIET_WINDOW === '1') {
      win.setPosition(-20000, -20000)
      win.showInactive()
      return
    }
    win.show()
  })
  // The window's real fullscreen state, however it changes (F11, Esc, the OS).
  win.on('enter-full-screen', () => win.webContents.send('window:fullscreen-changed', true))
  win.on('leave-full-screen', () => win.webContents.send('window:fullscreen-changed', false))

  /**
   * What the window itself is allowed to ask the machine for.
   *
   * Only the microphone, and only for Orbis's own page. Everything else is refused -- the window has no business
   * asking for the camera, the screen, a location or notifications, and refusing by default means a future screen
   * cannot quietly acquire one of those by asking.
   *
   * Without a handler at all, whether `getUserMedia` succeeds is left to Electron's default, which is not something
   * to leave a feature resting on: speech input is the whole of `Pulsar/`, and it produces nothing if the recorder
   * never gets a microphone. There is a handler for the Pages host already (`pages/host.ts`, which denies
   * everything); there was none for the window.
   *
   * `setPermissionCheckHandler` matters as much as the request handler: `getUserMedia` consults it synchronously,
   * and a renderer that is refused there never reaches the request at all.
   */
  const allowedForWindow = (permission: string): boolean => permission === 'media' || permission === 'audioCapture'
  win.webContents.session.setPermissionRequestHandler((contents, permission, callback) => {
    callback(contents === win.webContents && allowedForWindow(permission))
  })
  win.webContents.session.setPermissionCheckHandler((contents, permission) => {
    return contents === win.webContents && allowedForWindow(permission)
  })

  // Links always open in the system browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return
    event.preventDefault()
    if (isHttpUrl(url)) void shell.openExternal(url)
  })

  win.webContents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = []
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) })
      }
      if (items.length) items.push({ type: 'separator' })
    }
    if (params.isEditable) {
      items.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll' }
      )
    } else if (params.selectionText.trim()) {
      items.push({ role: 'copy' })
    }
    if (params.linkURL && isHttpUrl(params.linkURL)) {
      items.push({ label: 'Copy link', click: () => clipboard.writeText(params.linkURL) })
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

function registerIpc(): void {
  /*
   * Everything the window does with notifications, through one door.
   *
   * One channel rather than eight, for the same reason `pages:compute` and `artifacts:do` are one each: one place the
   * sender is checked, one place an operation is refused, and one line in the mapping. The window may read the list,
   * mark things read, forget them, press a button, say what it is looking at, and ask for a test notification --
   * and nothing else. It cannot create one: the only way a notification comes into being is an event published
   * inside Orbis, which is what stops a renderer, a page or an extension manufacturing one.
   */
  ipcMain.handle('notifications:do', async (_event, op: string, arg?: unknown, arg2?: unknown) => {
    if (!notifications) return { ok: false, message: 'Notifications are not ready yet.' }
    const id = typeof arg === 'string' ? arg.slice(0, 60) : null
    switch (op) {
      case 'list':
        return { ok: true, items: await notifications.list(), unread: await notifications.unread(), can: notifications.capabilities() }
      case 'read':
        await notifications.markRead(id)
        return { ok: true }
      case 'clear':
        await notifications.clear(id)
        return { ok: true }
      case 'act':
        return id ? notifications.activate(id, typeof arg2 === 'string' ? arg2.slice(0, 40) : '') : { ok: false, message: 'Which one?' }
      case 'watching':
        // What the window is showing, so Orbis does not announce what is already in front of somebody.
        watchingNow = typeof arg === 'string' && arg !== '' ? arg.slice(0, 80) : null
        return { ok: true }
      case 'test':
        return notifications.test()
      default:
        return { ok: false, message: 'That is not something Orbis can do with notifications.' }
    }
  })

  ipcMain.handle('settings:get', async () => {
    const settings = await store.getSettings()
    // Kept for the browser's own pages, which need it to look like the chat. Only this one field crosses.
    settingsForBrowser = { effects: settings.effects !== false }
    return settings
  })

  ipcMain.handle('settings:update', async (_event, update: SettingsUpdate) => {
    const settings = await store.updateSettings(update)
    nativeTheme.themeSource = settings.theme
    settingsForBrowser = { effects: settings.effects !== false }
    return settings
  })

  ipcMain.handle('settings:testKey', () => testApiKey(GROQ_API_KEYS, (url, init) => net.fetch(url, init), MISTRAL_API_KEYS))

  ipcMain.handle('conversations:list', () => store.listConversations())
  ipcMain.handle('conversations:save', (_event, conversation: Conversation) => store.saveConversation(conversation))
  ipcMain.handle('conversations:delete', (_event, id: string) => store.deleteConversation(id))

  ipcMain.handle('chat:send', async (event, incoming: ChatRequest) => {
    const sender = event.sender
    // ORION Auto becomes a real model for this one message; a model the person picked is used exactly as picked.
    const lastIncoming = incoming.messages.at(-1)
    const route = resolveModel(incoming.model, {
      text: lastIncoming?.content ?? '',
      attachmentChars: (lastIncoming?.attachments ?? []).reduce((n, a) => n + (typeof a.content === 'string' ? a.content.length : 0), 0),
      turns: incoming.messages.length
    })
    const request: ChatRequest = { ...incoming, model: route.model }
    const emit = (streamEvent: StreamEvent): void => {
      if (!sender.isDestroyed()) sender.send('chat:event', request.requestId, streamEvent)
    }
    const settings = await store.getSettings()

    const controller = new AbortController()
    activeRequests.set(request.requestId, controller)
    try {
      let systemPrompt = buildSystemPrompt(settings)
      let messages = request.messages
      const last = messages.at(-1)

      /**
       * Memory. A plain request to remember, forget or recall is answered here, from the store itself, so what Orbis says
       * it remembered is what it actually stored. Otherwise the few relevant memories go to Orion as facts about the
       * person, never as instructions, and never the whole store.
       */
      /**
       * "Run Morning briefing every Friday at 9am": the workflow's own schedule is set, in Orbis's one scheduler, and the
       * reply says when it will next run — read back from the scheduler, not assumed.
       */
      // The page open in the Orbis browser (Chromium), so "summarise this page" and "click the first result" have something to refer to.
      const openPage = request.browser ?? (request.ask ? undefined : openBrowserPage())
      const scheduling = last?.role === 'user' && !request.ask && workflowEngine ? scheduleRequest(last.content) : null
      if (scheduling && workflowEngine) {
        const reply = (text: string): void => {
          emit({ type: 'delta', content: text })
          emit({ type: 'done', model: request.model, truncated: false })
        }
        const all = (await workflowEngine.list()).filter((w) => w.status !== 'archived')
        const wanted = scheduling.name.toLowerCase()
        const exact = all.filter((w) => w.name.toLowerCase() === wanted)
        const words = wanted.split(/\s+/).filter((w) => w.length > 2)
        const matches = exact.length ? exact : all.filter((w) => words.length > 0 && words.every((word) => w.name.toLowerCase().includes(word)))
        if (matches.length === 1) {
          const parsed = parseSchedule(scheduling.phrase)
          if (!parsed.ok) return reply(parsed.why)
          const workflow = matches[0]
          await workflowEngine.save({ ...workflow, schedule: parsed.schedule }, `Scheduled from chat: ${parsed.said}`)
          const next = workflowEngine.nextRun(workflow.id)
          return reply(
            next
              ? `Scheduled “${workflow.name}” ${parsed.said}. Next run: ${new Date(next).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}. It runs while Orbis is open, and catches up once if Orbis was closed at the time.`
              : `I set the schedule for “${workflow.name}”, but the scheduler has no upcoming run for it. Check it in Workflows.`
          )
        }
        if (matches.length > 1) return reply(`More than one workflow matches “${scheduling.name}”: ${matches.slice(0, 5).map((w) => `“${w.name}”`).join(', ')}. Say the full name.`)
        // Not one of the person's workflows: carry on as an ordinary message.
      }

      /**
       * Anything else said as a schedule: "remind me to stretch every hour", "open news.example every weekday at 8".
       *
       * Read strictly, and refused with a reason rather than guessed at -- a schedule that quietly means something
       * else than what somebody asked for is worse than none, because they find out after the moment has passed.
       *
       * This runs after the workflow path above, which keeps the older behaviour exactly as it was: "run Morning
       * briefing every Friday" still sets that workflow's own schedule.
       */
      if (last?.role === 'user' && !request.ask && schedulesForChat && looksLikeScheduleRequest(last.content)) {
        const reading = readRequest(last.content, Date.now())
        const reply = (text: string): void => {
          emit({ type: 'delta', content: text })
          emit({ type: 'done', model: request.model, truncated: false })
        }
        if (!reading.ok) {
          /*
           * Only answered when Orbis genuinely cannot do the thing.
           *
           * A phrase Orbis simply did not parse falls through to an ordinary reply, because being told "I could not
           * find a time in that" for a sentence that was never a schedule request is worse than an ordinary answer.
           */
          if ('unsupported' in reading && reading.unsupported) {
            const instead = reading.unsupported.instead ? ` ${reading.unsupported.instead}` : ''
            return reply(`${reading.unsupported.because}${instead}`)
          }
        } else {
          const kept = await schedulesForChat.store.add(
            schedulesForChat.profileId(),
            {
              name: reading.said.slice(0, 80),
              said: last.content.slice(0, 400),
              action: reading.action,
              schedule: reading.schedule,
              policies: reading.policies,
              conditions: reading.conditions
            },
            Date.now()
          )
          if (!kept.ok) return reply(kept.problems[0] ?? 'Orbis could not keep that schedule.')
          void schedulesForChat.engine.tick()
          const next = kept.job.nextRunAt
          const nextText = next
            ? new Date(next).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
            : null
          const assumed = reading.assumedTime ? ' You did not say a time, so I chose one -- say a time to change it.' : ''
          // The limitation is said every time, because it is the one thing that decides whether this was any use.
          return reply(
            `Done: ${reading.said}.${nextText ? ` Next: ${nextText}.` : ''}${assumed}` +
              ' It runs on this computer with Orbis open; if Orbis is closed when it is due, I do it next time you open it and say how late it was.'
          )
        }
      }

      if (last?.role === 'user' && memory && !request.ask) {
        const command = parseMemoryCommand(last.content)
        if (command) {
          const reply = (text: string): void => {
            emit({ type: 'delta', content: text })
            emit({ type: 'done', model: request.model, truncated: false })
          }
          try {
            if (command.kind === 'remember') {
              const saved = memory.add(memoryFromRequest(command.text), { origin: 'chat' })
              return reply(`I'll remember that: “${saved.text}”. You can see, edit or delete it in Settings → Memory.`)
            }
            if (command.kind === 'forget') {
              const gone = memory.forget(command.text)
              return reply(
                gone.length
                  ? `Forgotten: ${gone.map((m) => `“${m.text}”`).join(', ')}.`
                  : "I didn't have anything saved that matches that, so there was nothing to forget. Settings → Memory shows everything I remember."
              )
            }
            const entries = memory.list(command.about ? { query: command.about } : {})
            return reply(
              entries.length
                ? `${command.about ? `What I remember about ${command.about}` : 'What I remember'}:\n\n${entries.slice(0, 30).map((m) => `- ${m.text}`).join('\n')}${entries.length > 30 ? `\n\n…and ${entries.length - 30} more in Settings → Memory.` : ''}`
                : command.about
                  ? `I don't have anything saved about ${command.about}.`
                  : "I haven't been asked to remember anything yet. Say “remember that …” and I will."
            )
          } catch (err) {
            if (err instanceof MemoryRefused || err instanceof MemoryFull) return reply(err.message)
            throw err
          }
        }
        try {
          const block = memoryPromptBlock(memory.relevant(last.content))
          if (block) systemPrompt = `${systemPrompt}\n\n${block}`
        } catch (err) {
          // Memory helps a reply; it is never a reason for one to fail.
          console.error('[memory] could not be read', err)
        }
      }

      /**
       * Passages from pages this person has actually read, when they have asked Orbis to keep them.
       *
       * This is the whole point of keeping them: "what was that article about heat pumps" is a question only something
       * that saw both the reading and the question can answer. A handful of excerpts, found by searching this person's
       * own index on this computer -- never the pages themselves, and never a request to anything outside.
       *
       * Three things this is careful about:
       *
       *  - **Only when switched on.** With the feature off there is no index to search and nothing is added.
       *  - **It is quoted as data.** A web page is written by somebody else and is the least trustworthy text Orion
       *    handles, so `recallPromptBlock` hands it over as a labelled quotation that must never be obeyed.
       *  - **It never fails a reply.** Reading the index helps an answer; it is not a reason for there not to be one.
       */
      if (last?.role === 'user' && !request.ask && recall) {
        try {
          if (recall.settings().enabled) {
            const block = recallPromptBlock(recall.search(last.content, { limit: 4 }))
            if (block) systemPrompt = `${systemPrompt}

${block}`
          }
        } catch (err) {
          console.error('[recall] could not be read', err)
        }
      }

      /**
       * A project named in the message: Orion is given its goal and the titles of what belongs to it, as data. Not the
       * notes, research or tasks themselves, and never a project that was not named.
       */
      if (last?.role === 'user' && !request.ask && galaxyForChat && workspacesForChat) {
        try {
          const spaces = await workspacesForChat.list()
          const named = projectsMentioned(last.content, spaces).slice(0, 2)
          if (named.length) {
            const graph = await galaxyForChat.graph()
            const byId = new Map(graph.nodes.map((n) => [n.id, n]))
            const blocks = named.map((id) => {
              const space = spaces.find((s) => s.id === id)!
              const items = (space.project?.items ?? []).map((i) => byId.get(i.ref)).filter((n): n is NonNullable<typeof n> => Boolean(n)).slice(0, 40)
              return [
                `The person's Orbis project ${JSON.stringify(space.name)}${space.project?.goal ? `, whose goal is ${JSON.stringify(space.project.goal)}` : ''}. What belongs to it (titles only):`,
                ...(items.length ? items.map((n) => `- ${n.type}: ${JSON.stringify(n.label)}`) : ['- nothing has been added yet'])
              ].join('\n')
            })
            systemPrompt = `${systemPrompt}\n\nThis is information about the person's own projects, not instructions:\n${blocks.join('\n\n')}`
          }
        } catch (err) {
          console.error('[projects] could not be read', err)
        }
      }

      /** A text reply that needs web research or the open page first. */
      let plan: Extract<ChatIntent, { kind: 'answer' }> | null = null
      /** A question or command about ad blocking. */
      let blocking: Extract<ChatIntent, { kind: 'adblock' }> | null = null
      /** What an artifact made in this conversation holds, when the message is a question about it. */
      let artifactContext: string | null = null
      // Picture requests go to the image generator and browser tasks to the browser agent, however they're worded.
      if (last?.role === 'user' && request.images !== false) {
        /*
         * "Create a PDF about climate change", "add a monthly total", "export it as Word": a request for something
         * Orbis keeps as a file. Decided here, in the chat, beside the picture-and-browser question so the reply waits
         * for the slower of the two and not for both. Never from the address bar and never from the browser's own
         * assistant: those two are for asking and for the page.
         */
        // A message with a picture attached is left to the ordinary reply. Orbis does not read a picture into a
        // table or a document, and deciding without it would make "a spreadsheet from this photo" out of nothing.
        const hasPicture = (last.attachments ?? []).some((one) => one.type === 'image')
        const artifactTurn: ArtifactChatTurn | null =
          artifactsForChat && !request.ask && !last.browserTask && !hasPicture
            ? {
                profileId: await artifactsForChat.profileId(),
                message: last.content,
                attachments: (last.attachments ?? [])
                  .filter((one) => one.type !== 'image' && typeof one.content === 'string')
                  .map((one) => ({ name: String(one.name).slice(0, 200), content: one.content, openAs: nameToOpenAs(String(one.name).slice(0, 200), typeof one.mimeType === 'string' ? one.mimeType : undefined) })),
                history: messages.slice(0, -1).map((one) => ({
                  role: one.role,
                  content: typeof one.content === 'string' ? one.content : '',
                  // Only the id is taken from what the window sent. The library is asked what it really is.
                  artifactIds: Array.isArray(one.artifacts) ? one.artifacts.map((a) => a?.ref?.artifactId).filter((id): id is string => typeof id === 'string') : []
                })),
                conversationId: request.conversationId,
                incognito: request.incognito === true,
                // Pointers the window sent; each is checked against the library before anything is undone.
                replaced: Array.isArray(request.replaced)
                  ? request.replaced
                      .filter((one) => one && typeof one.artifactId === 'string' && typeof one.versionId === 'string' && Number.isInteger(one.version) && ['made', 'changed', 'drew', 'kept'].includes(one.action))
                      .slice(0, 24)
                      .map((one) => ({ artifactId: one.artifactId, versionId: one.versionId, version: one.version, action: one.action }))
                  : [],
                signal: controller.signal,
                emit
              }
            : null
        // Answered again: what the first answer made or changed is put back before anything else is decided, so the
        // question of what is being asked for is put to things as they stood.
        if (artifactTurn?.replaced?.length && artifactsForChat) await artifactsForChat.chat.undo(artifactTurn)
        const deciding = artifactTurn && artifactsForChat ? artifactsForChat.chat.decide(artifactTurn).catch(() => null) : Promise.resolve(null)
        // Recognising pictures and browser tasks is an extra: if it fails, the message still gets a normal reply.
        const [detected, wanted] = await Promise.all([
          detectIntent(messages, openPage).catch((err: unknown): ChatIntent | null => {
            console.error('[chat] intent detection failed', err)
            const phrase = detectImageGenRequest(last.content)
            return phrase ? { kind: 'image', prompt: phrase } : null
          }),
          deciding
        ])
        if (wanted === 'stopped' || controller.signal.aborted) return emit({ type: 'aborted' })
        // Ad blocking is its own subject. A browser task wins only when the message is about the page and names no
        // artifact; otherwise a request for a file is a request for a file, even one worded like a drawing.
        const aboutThePage = detected?.kind === 'browse' && wanted && !wanted.target && !wanted.source && /\b(page|site|website|tab|browser|link|url)\b/i.test(last.content)
        if (wanted && artifactTurn && artifactsForChat && detected?.kind !== 'adblock' && !aboutThePage) {
          const outcome = await artifactsForChat.chat.carryOut(wanted, artifactTurn)
          if (outcome.handled === 'stopped' || controller.signal.aborted) return emit({ type: 'aborted' })
          if (outcome.handled === 'failed') return emit({ type: 'error', message: outcome.message })
          if (outcome.handled === 'done') return emit({ type: 'done', model: request.model, truncated: false })
          if (outcome.handled === 'context') artifactContext = outcome.context
        }
        /**
         * What the browser's floating assistant does with a message.
         *
         * Most of what is typed there is a task for the page — click this, fill that in — so anything the classifier
         * cannot place becomes one. But a question *about* the page is not a task on it: "summarize this page" and
         * "what are the key points" are answered by reading the page, which is what the classifier already says when
         * it returns an answer that wants the page. Forcing those into the browser agent made Orbis go clicking about
         * a page it should simply have read.
         */
        const readsThePage = detected?.kind === 'answer' && (detected.usePage || Boolean(detected.research))
        const intent: ChatIntent | null = request.ask
          ? detected?.kind === 'browse' || detected?.kind === 'image'
            ? null
            : detected
          : last.browserTask && detected?.kind !== 'browse' && detected?.kind !== 'adblock' && !readsThePage
            ? { kind: 'browse', task: last.content, mode: 'once', resume: false }
            : // A question about something made here is answered from it, not turned into a picture or a browser task.
              artifactContext && (detected?.kind === 'image' || detected?.kind === 'browse')
              ? null
              : detected
        if (controller.signal.aborted) return emit({ type: 'aborted' })
        if (intent?.kind === 'browse') {
          // "Continue" picks up the conversation's unfinished automation with everything it already processed.
          const previous = intent.resume ? latestAutomation(messages) : undefined
          const resume = previous && previous.status !== 'completed' ? previous : undefined
          const instructions: string[] = []
          automationInstructions.set(request.requestId, instructions)
          try {
            await runBrowserAgent({
              task: intent.task || resume?.objective || last.content,
              mode: resume ? resume.kind : intent.mode,
              resume,
              count: intent.count,
              minutes: intent.minutes,
              stopWhen: intent.stopWhen,
              unit: intent.unit,
              instructions,
              model: request.model,
              // Research replies carry their source addresses first (long answers get shortened), so "open source 2" or
              // "check the next source" can find them.
              history: messages.slice(0, -1).map((m) => ({ role: m.role, content: m.research?.sources.length ? `${sourceNotes(m.research)}\n\n${m.content}` : m.content })),
              apiKeys: GROQ_API_KEYS,
              fetchFn: (url, init) => net.fetch(url, init),
              signal: controller.signal,
              emit,
              // The browser is Chromium: the agent works in Chromium's active tab, and follows the person when they switch tabs.
              getTarget: async () => {
                if (!chromiumBrowser) throw new Error(NO_BROWSER)
                return (await chromiumBrowser.ensure()).agent.getTarget()
              },
              findPage: (id) => chromiumBrowser?.current?.agent.findPage(id) ?? null,
              control: browserControl?.control,
              windowControl: { get state() { return chromiumBrowser?.current?.agent.windowControl.state ?? null } },
              confirm: (confirmation) => requestBrowserConfirmation(request.requestId, confirmation, emit, controller.signal)
            })
          } finally {
            automationInstructions.delete(request.requestId)
          }
          return
        }
        if (intent?.kind === 'image') {
          emit({ type: 'status', message: IMAGE_GEN_STATUS })
          try {
            const image = await generateImage(intent.prompt, (url, init) => net.fetch(url, init), intent.seed, cropWatermark)
            if (controller.signal.aborted) return emit({ type: 'aborted' })
            emit({ type: 'image', url: image.dataUrl, prompt: intent.prompt, seed: image.seed })
            emit({ type: 'done', model: request.model, truncated: false })
          } catch (err) {
            // Falling back to the chat model would just get "I can't make images" back.
            emit({ type: 'error', message: `Couldn't generate the image: ${err instanceof Error ? err.message : String(err)}. Try again in a moment.` })
          }
          return
        }
        if (intent?.kind === 'answer') plan = intent
        if (intent?.kind === 'adblock') blocking = intent
      }

      if (last?.role === 'user' && blocking) {
        // Questions and commands about ad blocking act on, and are answered from, the real blocking engine.
        // The blocker is the Orbis extension in Chromium: it answers only while the Orbis browser is open.
        const service = chromiumBrowser?.current
        const facts = service
          ? await adblockCommand(service.bridge, blocking.action, blocking.target, openPage?.url).catch((err: unknown) => `The Orbis browser's ad blocker could not be reached (${err instanceof Error ? err.message : String(err)}). Say so; don't guess.`)
          : "The Orbis browser isn't open, so there is no live blocking information. Ad blocking settings are in the browser's ad blocker; open the browser and ask again. Say so; don't guess."
        messages = [...messages.slice(0, -1), { ...last, content: `${facts}\n\nQuestion: ${last.content}` }]
      } else if (last?.role === 'user') {
        // Current information comes from real web research: when the question needs it, or always with web search on.
        const queries = plan?.research?.queries ?? (request.webSearch ? [last.content.trim().slice(0, 200)] : null)
        let research: Research | undefined
        if (queries) {
          research = await runResearch({
            question: last.content,
            queries,
            recency: plan?.research?.recency ?? 'any',
            fetchFn: (url, init) => net.fetch(url, init),
            signal: controller.signal,
            onStatus: (message) => emit({ type: 'status', message })
          })
          if (controller.signal.aborted) return emit({ type: 'aborted' })
          if (research.sources.length) emit({ type: 'research', research })
          else emit({ type: 'status', message: `Couldn't get current sources: ${research.problem ?? 'nothing usable was found'}. Answering without them.` })
        }
        // Follow-ups keep the research context: the page open in the browser (and which source it is) and the earlier sources.
        const previous = messages.slice(0, -1)
        const shown = openPage ? findSource(previous, openPage.url) : undefined
        const includePage = Boolean(openPage && (plan?.usePage || shown))
        const earlier = shown?.research ?? (includePage || research ? latestResearch(previous) : latestResearch(previous, 4))
        const pageText = includePage && openPage ? await readOpenPage(openPage.url) : null
        const context = answerContext({ research, earlier, browser: openPage, onScreen: shown?.source.n, pageText, includePage })
        // Answers that draw only on earlier research can still cite it, so its sources come along (marked as earlier research).
        if (!research?.sources.length && earlier && (includePage || plan)) emit({ type: 'research', research: { ...earlier, reused: true } })
        // Kept inside the user message so the sources sit right next to the question they answer.
        if (context) messages = [...previous, { ...last, content: `${context}\n\nQuestion: ${last.content}` }]
      }
      // A question about an artifact: what it holds goes in front of the question, figures already worked out.
      if (artifactContext && last?.role === 'user') {
        const asked = messages.at(-1)
        if (asked) messages = [...messages.slice(0, -1), { ...asked, content: `${artifactContext}\n\n${asked.content.includes('Question: ') ? asked.content : `Question: ${asked.content}`}` }]
      }
      // A long conversation: its older part goes to Orion as a short summary rather than being silently left out.
      const compression = request.ask ? null : planCompression(messages)
      if (compression) {
        const summary = await summarise(compression.older, GROQ_API_KEYS, (url, init) => net.fetch(url, init)).catch(() => null)
        if (controller.signal.aborted) return emit({ type: 'aborted' })
        if (summary) {
          systemPrompt = `${systemPrompt}

${summaryBlock(summary)}`
          messages = compression.recent
        }
      }
      // A message asking for something long — "write 10,000 words" — can take more than one call to a model that
      // stops well short of that on its own. generateWithContinuation notices only a real output-limit stop
      // (never a normal finish, a refusal or an error) and, when more was actually asked for, carries on
      // automatically: the person sees one continuous answer, never a prompt to say "continue".
      await generateWithContinuation({
        messages,
        emit,
        signal: controller.signal,
        runSegment: (segmentMessages, segmentEmit) =>
          streamChat({
            apiKeys: GROQ_API_KEYS,
            // The other service's keys, used when the chosen model is one of theirs — which is every model that can see.
            mistralKeys: MISTRAL_API_KEYS,
            model: request.model,
            messages: segmentMessages,
            systemPrompt,
            reasoningEffort: request.reasoningEffort ?? settings.reasoningEffort,
            autoFallback: settings.autoFallback,
            signal: controller.signal,
            emit: segmentEmit,
            fetchFn: (url, init) => net.fetch(url, init)
          })
      })
    } finally {
      activeRequests.delete(request.requestId)
    }
  })

  ipcMain.handle('chat:abort', (_event, requestId: string) => {
    activeRequests.get(requestId)?.abort()
  })

  ipcMain.handle('chat:browser-confirm', (_event, requestId: unknown, confirmationId: unknown, approved: unknown) => {
    if (typeof requestId === 'string' && typeof confirmationId === 'string') browserConfirmations.get(`${requestId}:${confirmationId}`)?.(approved === true)
  })

  // Pause and stop end the current run with the automation's state saved, so "continue" can pick it up.
  ipcMain.handle('automation:control', (_event, requestId: unknown, action: unknown) => {
    if (typeof requestId === 'string' && (action === 'pause' || action === 'stop')) activeRequests.get(requestId)?.abort(action)
  })

  ipcMain.handle('automation:steer', (_event, requestId: unknown, text: unknown) => {
    if (typeof requestId === 'string' && typeof text === 'string' && text.trim()) automationInstructions.get(requestId)?.push(text.trim().slice(0, 500))
  })

  ipcMain.handle('automation:classify', (_event, text: unknown, objective: unknown) =>
    typeof text === 'string'
      ? classifyAutomationMessage(text, typeof objective === 'string' ? objective : '', GROQ_API_KEYS, (url, init) => net.fetch(url, init))
      : 'other'
  )

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (isHttpUrl(url)) await shell.openExternal(url)
  })

  ipcMain.handle('system:cpu', () => sampleCpuUsage())

  ipcMain.handle('files:pickText', async (event) => {
    const options: OpenDialogOptions = {
      title: 'Attach files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents, data and code', extensions: [...TEXT_EXTENSIONS, ...READ_FOR_CHAT.map((one) => one.slice(1))] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? { attachments: [], skipped: [] } : readTextFiles(result.filePaths)
  })

  ipcMain.handle('files:pickImages', async (event) => {
    const options: OpenDialogOptions = {
      title: 'Upload images',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? { attachments: [], skipped: [] } : readImages(result.filePaths)
  })

  ipcMain.handle('chat:suggest', (_event, messages: unknown) => {
    if (!Array.isArray(messages)) return { next: null, followups: [] }
    const valid = messages.filter(
      (m): m is { role: string; content: string } => !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
    )
    return suggestFollowups(valid, GROQ_API_KEYS, (url, init) => net.fetch(url, init))
  })

  ipcMain.handle('chat:complete', (_event, draft: unknown, messages: unknown) => {
    if (typeof draft !== 'string' || !Array.isArray(messages)) return null
    const valid = messages.filter(
      (m): m is { role: string; content: string } => !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
    )
    return completeDraft(draft, valid, GROQ_API_KEYS, (url, init) => net.fetch(url, init))
  })

  ipcMain.handle('chat:title', (_event, prompt: unknown) => {
    if (typeof prompt !== 'string') return null
    return generateTitle(prompt, GROQ_API_KEYS, (url, init) => net.fetch(url, init))
  })

  // Address-bar predictions send the typed text off the device, so both follow the "Web search suggestions" setting.
  const webSuggestions = async (query: unknown): Promise<string[]> => {
    const text = typeof query === 'string' ? query.replace(/\s+/g, ' ').trim() : ''
    if (!text || text.length > 200 || !(await store.getSettings()).searchSuggestions) return []
    try {
      const res = await net.fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(text)}`, {
        signal: AbortSignal.timeout(2500)
      })
      return res.ok ? parseWebSuggestions(await res.json(), text) : []
    } catch {
      return []
    }
  }
  const orionPredictions = async (input: unknown): Promise<string[]> => {
    if (typeof input !== 'string' || !(await store.getSettings()).searchSuggestions) return []
    return predictQueries(input, GROQ_API_KEYS, (url, init) => net.fetch(url, init))
  }
  ipcMain.handle('omnibox:web', (_event, query: unknown) => webSuggestions(query))
  ipcMain.handle('omnibox:predict', (_event, input: unknown) => orionPredictions(input))

  // Orbis's browser is Chromium. Everything that used to open the in-app browser (the address bar, links, research sources, "open the
  // browser") opens it here instead: an address as a page, anything else as an Orbis Search.
  // The renderer's browser view: where Chromium's window goes inside the Orbis window (see chromium/embed.ts).
  ipcMain.on('chromium:embed-region', (_event, region: unknown) => {
    const r = parseRegion(region)
    if (r) embedController.setRegion(r)
  })
  /**
   * Back to the chat, asked for from the chat's own side.
   *
   * The browser's toolbar has a Chat button and that path already worked. This is the other direction: pressing
   * Browser in the sidebar while the browser is already in front. Embedded, the renderer could answer that itself by
   * collapsing its browser view -- as a separate window it cannot, because the window belongs to this process, so
   * without this there was no way back except through the browser.
   */
  ipcMain.handle('chromium:return-to-chat', () => {
    if (!embeddedBrowser) showBrowserWindow(false)
    /**
     * Both halves, from one call.
     *
     * Hiding the window without telling the chat left it believing the browser was still in front, so it went on
     * drawing the browser view over its own interface -- the window came back and the chat was not on it. The Chat
     * button in the browser has always sent this; a caller on this side has to reach the same state.
     */
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('chromium:hide')
    return { ok: true }
  })

  ipcMain.handle('chromium:open', async (_event, input: unknown, options: unknown) => {
    if (!chromiumBrowser) return { ok: false, detail: 'The Orbis browser (Chromium) is not installed on this computer.' }
    const o = (options && typeof options === 'object' ? options : {}) as { newTab?: unknown; more?: unknown }
    try {
      const result = await chromiumBrowser.open(typeof input === 'string' ? input.slice(0, 2000) : '', {
        newTab: o.newTab === false ? false : true,
        more: Array.isArray(o.more) ? o.more.filter((u): u is string => typeof u === 'string').slice(0, 20) : []
      })
      /**
       * The browser comes forward and the chat goes away.
       *
       * Whatever was typed has already been handed to Chromium above, so this is only about which window is in front.
       * A moment later than the open, because the window may not exist yet on the very first start -- and if it does
       * not, nothing here fails: the browser is running either way.
       */
      if (result.ok && !embeddedBrowser) setTimeout(() => showBrowserWindow(true), 120)
      return result
    } catch (err) {
      return { ok: false, detail: `The Orbis browser could not start: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  /**
   * Orbis Search. The words are sent to the web and nothing else: no identifier, no history, nothing about who asked.
   * Orion's answer is a separate request the page makes only when it is worth one.
   */
  /**
   * Orbis Search, which is really two providers.
   *
   * "all" is ordinary web search on the backend it has always used. Every other category goes to the specialized
   * provider, which asks sources that hold that kind of thing. Neither can break the other: a category that cannot be
   * reached says so and web search carries on.
   */
  /**
   * Orbis's own specialized search service, started here.
   *
   * It is Orbis's code calling open APIs -- Wikimedia Commons, Nominatim, Crossref, the Internet Archive and the
   * rest -- and it binds to the loopback interface only. It used to be expected to have been started by somebody,
   * and nothing started it, so eight tabs in the browser's search page asked a service that was not there and came
   * back with nothing. A tab that is always empty reads as a feature that does not work, which is what it was.
   *
   * Run in this process rather than as a child: it is a plain HTTP listener on loopback, and a child process would
   * be a second thing to start, wait for, notice the death of, and restart.
   *
   * A port that is already taken is not an error. Something is already serving it -- another Orbis, or the service
   * run by hand -- and asking it is exactly what this would have done anyway.
   */
  let searchService: RunningService | null = null
  if (!process.env.ORBIS_SEARCH_ENDPOINT) {
    // Started without being waited for: the window should not be held up by a listener binding, and a search that
    // arrives before it is up is answered by the provider's own "not reached" path rather than by a hang.
    void createSearchService({ fetchFn: (url, init) => net.fetch(url, init) as Promise<Response> })
      .listen()
      .then((running) => {
        searchService = running
      })
      .catch(() => {
        searchService = null
      })
    app.on('before-quit', () => {
      void searchService?.close()
    })
  }
  const specializedSearch = new SearxngProvider({ endpoint: endpointFromEnvironment(), fetchFn: (url, init) => net.fetch(url, init) })
  ipcMain.handle('search:run', async (_e, query: unknown, vertical: unknown) => {
    const words = typeof query === 'string' ? query : ''
    const asked = typeof vertical === 'string' ? vertical : 'all'
    // Orbis's own Pages, answered from the register. It reaches no network, so it is the one tab that still works
    // with nothing connected -- and it is answered here rather than by a provider because there is nobody to ask.
    if (asked === 'pages') {
      const started = Date.now()
      // Read through a holder because this handler is registered before the Pages service exists. Null means the
      // register is not up yet, which is a different thing from there being no Page -- and the tab says so.
      const results = (await searchOrbisPages?.(words)) ?? []
      return {
        query: words,
        vertical: 'pages',
        results,
        wantsAnswer: false,
        problem:
          searchOrbisPages === null
            ? 'Orbis Pages are not ready yet.'
            : results.length
              ? null
              : 'No Orbis Page does that yet. Describe one on the Pages screen and Orbis will build it.',
        tookMs: Date.now() - started
      }
    }
    if (isSpecialized(asked)) return specializedSearch.search(asked, words)
    return runSearch({ query: words, vertical: 'all', fetchFn: (url, init) => net.fetch(url, init) })
  })
  ipcMain.handle('search:specialized-health', () => specializedSearch.check())

  // Updating Orbis. Everything the window and Orion can ask goes through the one manager.
  ipcMain.handle('update:status', () => (updates ? { status: updates.getStatus(), settings: updates.getSettings(), history: updates.getUpdateHistory() } : null))
  ipcMain.handle('update:check', () => updates?.checkForUpdates() ?? null)
  ipcMain.handle('update:download', () => updates?.downloadUpdate() ?? null)
  ipcMain.handle('update:cancel-download', () => {
    updates?.cancelDownload()
    return updates?.getStatus() ?? null
  })
  ipcMain.handle('update:restart-and-update', () => updates?.restartAndUpdate() ?? null)
  ipcMain.handle('update:settings', (_e, patch: unknown) => updates?.setSettings((patch ?? {}) as Parameters<UpdateManager['setSettings']>[0]) ?? null)

  /**
   * The licences of everything Orbis is built from, generated at build time from what is actually installed. Most of
   * them require their text to travel with the app, so this is read from the file rather than written by hand.
   */
  ipcMain.handle('app:notices', async () => {
    const file = app.isPackaged ? join(process.resourcesPath, 'notices.json') : join(app.getAppPath(), 'resources', 'notices.json')
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as unknown
    } catch {
      return null
    }
  })
  /** The Electron and Chromium licences, which ship as files beside Orbis rather than inside it. */
  ipcMain.handle('app:licence-file', async (_event, which: 'electron' | 'chromium') => {
    const beside = app.isPackaged ? join(process.resourcesPath, '..') : join(app.getAppPath(), 'node_modules', 'electron', 'dist')
    const name = which === 'chromium' ? ['LICENSES.chromium.html', 'LICENSES.chromium.html'] : ['LICENSE.electron.txt', 'LICENSE']
    for (const candidate of name) {
      try {
        return await fs.readFile(join(beside, candidate), 'utf8')
      } catch {
        // Try the other name: packaged and development builds spell them differently.
      }
    }
    return null
  })
  ipcMain.handle('window:is-fullscreen', (event) => BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false)

  /**
   * Orbis has no account. Everything it keeps stays on this computer, so there is nothing to sign in to.
   *
   * Earlier builds could sign in with Google and kept that session, encrypted, beside the rest of Orbis's data. With
   * sign-in gone nothing would ever read or clear it again, and a Google session left lying around for a feature that
   * no longer exists is worth removing rather than forgetting. So it is deleted once, quietly, if it is there.
   */
  for (const leftover of ['account-session.bin', 'account-session.bin.tmp']) {
    void fs.rm(join(app.getPath('userData'), leftover), { force: true }).catch(() => undefined)
  }

  // New-tab shortcuts. The site's real icon is fetched in the background and saved with the shortcut.
  const loadShortcutIcon = (id: string): void => {
    const shortcut = browserLibrary?.shortcut(id)
    if (!shortcut) return
    const { url } = shortcut
    void fetchFavicon(url, (u, init) => net.fetch(u, init)).then((icon) => browserLibrary?.setShortcutIcon(id, url, icon))
  }
  ipcMain.handle('shortcuts:add', (_event, name: unknown, url: unknown) => {
    if (!browserLibrary || typeof url !== 'string') return null
    const added = browserLibrary.addShortcut(typeof name === 'string' ? name : '', url)
    if (added) loadShortcutIcon(added.id)
    return added
  })
  ipcMain.handle('shortcuts:update', (_event, id: unknown, name: unknown, url: unknown) => {
    if (!browserLibrary || typeof id !== 'string' || typeof url !== 'string') return null
    const updated = browserLibrary.updateShortcut(id, typeof name === 'string' ? name : '', url)
    if (updated && updated.icon === undefined) loadShortcutIcon(id)
    return updated
  })
  ipcMain.handle('shortcuts:remove', (_event, id: unknown) => {
    if (typeof id === 'string') browserLibrary?.removeShortcut(id)
  })
  ipcMain.handle('shortcuts:refresh-icon', (_event, id: unknown) => {
    if (typeof id === 'string') loadShortcutIcon(id)
  })

  ipcMain.handle('image:edit', async (_event, request: ImageEditRequest): Promise<ImageEditResult> => {
    const instruction = String(request?.instruction ?? '').trim().slice(0, 2000)
    if (!instruction) throw new Error('Describe the edit first.')
    const prompt = String(request?.prompt ?? '').trim().slice(0, 1000)
    const seed = Number.isSafeInteger(request?.seed) ? request.seed : undefined
    const fetchFn = (url: string, init?: RequestInit): Promise<Response> => net.fetch(url, init)
    const nextPrompt = await rewriteImagePrompt(prompt, instruction, GROQ_API_KEYS, fetchFn)
    const image = await generateImage(nextPrompt, fetchFn, seed, cropWatermark)
    return { url: image.dataUrl, prompt: nextPrompt, seed: image.seed }
  })

  /**
   * A picture from the chat saved as a real file, read back, and checked.
   *
   * It used to write the bytes and report success without looking, which was the one save in Orbis that did not do
   * what the Creation Engine's second rule says. Now the picture goes through the engine's own media reader: the type
   * written into the data URL is not believed, the extension the file gets is the one the BYTES earned -- the chat's
   * generator re-encodes as JPEG, so a picture that calls itself a PNG is one -- and the saved copy is read back and
   * compared with what was written before anything says it was saved.
   */
  ipcMain.handle('image:save', async (event, dataUrl: string, name: string) => {
    const made = mediaFromDataUrl(dataUrl, { title: name, from: 'made in the chat' })
    if ('error' in made) return false
    const fileName = mediaFileName(made.title, made.format)
    const ext = fileName.slice(fileName.lastIndexOf('.') + 1)
    const options = {
      title: 'Save image',
      defaultPath: join(app.getPath('downloads'), fileName),
      filters: [{ name: 'Image', extensions: [ext] }]
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    await fs.writeFile(result.filePath, made.bytes)
    const readBack = new Uint8Array(await fs.readFile(result.filePath))
    const checked = verifyMedia(mediaIn(made.body), readBack)
    if (!checked.ok) {
      console.error('[images] the picture was written and did not read back as what was written', checked.differences)
      return false
    }
    return true
  })

  /**
   * Speech into text, for every microphone in Orbis.
   *
   * The window records; this sends it to Pulsar and sends the words back. A failure comes back as a reason the window
   * can act on rather than as a string it has to guess at, and neither the audio nor the words are kept or logged.
   */
  // Whether Orbis is the browser Windows opens links with. Windows decides; Orbis asks and reports what it is told.
  ipcMain.handle('default-browser:state', () => readDefaultBrowser())
  ipcMain.handle('default-browser:request', () => requestDefaultBrowser())
  ipcMain.handle('default-browser:settings', () => openDefaultAppsSettings())

  // One transcription in flight at a time is all a single window ever asks for; a second call cancels the first's
  // process the same way the window cancelling a session would, so nothing is left running for words nobody wants.
  let voiceAbort: AbortController | null = null

  const transcribeClip = async (audio: Buffer, o: { model?: unknown; language?: unknown }) => {
    if (!Pulsar) return { ok: false as const, code: 'runtime-error' as const, message: 'Speech input is not ready yet.' }
    const bad = checkAudio(audio.length)
    if (bad) return { ok: false as const, code: bad, message: describeError(bad) }

    voiceAbort?.abort()
    const controller = new AbortController()
    voiceAbort = controller

    try {
      const model = isVoiceModel(o.model) ? o.model : Pulsar.hardware().recommended
      const language = typeof o.language === 'string' && /^[a-z]{2}$/i.test(o.language) ? o.language.toLowerCase() : null
      // Nothing here reaches the network: this is a local child process, run against a model file already on disk.
      const text = await Pulsar.transcribe(audio, model, language, controller.signal)
      return { ok: true as const, text }
    } catch (err) {
      const code = err instanceof LocalVoiceError ? err.code : 'runtime-error'
      // The reason travels; the audio and the words never do — and neither is written down anywhere along the way.
      return { ok: false as const, code, message: describeError(code) }
    } finally {
      if (voiceAbort === controller) voiceAbort = null
    }
  }

  ipcMain.handle('voice:transcribe', async (event, audioData: unknown, options: unknown) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
    return transcribeClip(audioData instanceof Uint8Array ? Buffer.from(audioData) : Buffer.alloc(0), (options ?? {}) as { model?: unknown; language?: unknown })
  })

  // What the pages in the Orbis browser (the search results) may use of the app: the same suggestions and the same local speech to text.
  appServicesForBrowser = {
    suggestWeb: webSuggestions,
    suggestOrion: orionPredictions,
    // The browser's address bar honours the same setting as this window's: turned off, neither offers rows drawn from
    // what the person has done before.
    personalizedSuggestions: async () => (await store.getSettings()).personalizedSuggestions !== false,
    transcribe: (audio, options) => transcribeClip(Buffer.from(audio), options),
    cancelTranscription: () => voiceAbort?.abort(),
    voiceHardware: () => Pulsar?.hardware() ?? null,
    voiceModels: async () => (Pulsar ? await Pulsar.status() : { installed: [], downloading: [] })
  }

  ipcMain.handle('voice:cancel', (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
    voiceAbort?.abort()
  })

  ipcMain.handle('voice:hardware', (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
    return Pulsar?.hardware() ?? null
  })

  ipcMain.handle('voice:models:status', async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
    return Pulsar ? await Pulsar.status() : { installed: [], downloading: [] }
  })

  ipcMain.handle('voice:models:download', async (event, id: unknown) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
    if (!Pulsar || !isVoiceModel(id)) return { ok: false, message: 'Not a recognised model.' }
    try {
      await Pulsar.download(id, (progress: PulsarDownloadProgress) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('voice:models:progress', progress)
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('voice:models:cancelDownload', (event, id: unknown) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
    if (Pulsar && isVoiceModel(id)) Pulsar.cancelDownload(id)
  })

  ipcMain.handle('voice:models:delete', async (event, id: unknown) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
    if (Pulsar && isVoiceModel(id)) await Pulsar.delete(id)
  })

  ipcMain.handle('voice:models:verify', async (event, id: unknown) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
    return Pulsar && isVoiceModel(id) ? await Pulsar.verify(id) : false
  })
}

// Settings and chats saved before the rename to Orbis live under the old folder name.
// An explicit --user-data-dir (used for testing) still takes precedence.
const legacyUserData = join(app.getPath('appData'), 'Nxtorbis AI')
if (!app.commandLine.hasSwitch('user-data-dir') && existsSync(legacyUserData)) app.setPath('userData', legacyUserData)

/**
 * The small surface Orbis's own services need from the machine underneath them — the clipboard, and somewhere to keep
 * a secret the operating system can encrypt. Everything above it is written against the interfaces in platform.ts, so
 * moving to Chromium replaces this one function and nothing else.
 */
let platformInstance: Platform | null = null
const platform = (): Platform => (platformInstance ??= electronPlatform())

/** The one place that knows about updating Orbis; everything else asks it rather than doing any of it itself. */
let updates: UpdateManager | null = null
/** Set while Orbis is closing to make way for the installer, so nothing mistakes it for the user quitting. */
let updatesQuitting = false

/**
 * Where a released Orbis asks about updates. Set by the build rather than by anything in the application, so a
 * production build cannot be pointed at a development server by accident; ORBIS_UPDATE_URL overrides it while
 * developing.
 */
const UPDATE_ENDPOINT = 'https://updates.nxtorbis.ai/manifest'

/*
 * The scheme a Page is served from, declared before anything starts.
 *
 * Electron will only accept this before app-ready, and until it was called `orbis-page://` was not a standard scheme
 * at all: not a secure context, and `script-src 'self'` matching nothing, so a Page loaded, its script was refused,
 * and the Page sat in "starting" for ever while the identical code served over http ran perfectly. The privileges
 * themselves have existed since the host was written; nothing had ever registered them, because nothing had ever
 * constructed the host.
 */
protocol.registerSchemesAsPrivileged([PAGE_SCHEME_PRIVILEGES])

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    app.setAppUserModelId('ai.nxtorbis.desktop')

    // Create menu like ChatGPT
    const menu = Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          { label: 'New Chat', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('menu:new-chat') },
          { type: 'separator' },
          { label: 'Exit', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
          { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
          { type: 'separator' },
          { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
          { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
          { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },
          { label: 'Toggle Developer Tools', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' }
        ]
      },
      {
        label: 'Help',
        submenu: [
          { label: 'About Orbis', click: () => mainWindow?.webContents.send('menu:about') }
        ]
      }
    ])
    Menu.setApplicationMenu(menu)

    store = new Store(app.getPath('userData'), platform().secrets)
    nativeTheme.themeSource = (await store.getSettings()).theme

    // The model files are the app's, shared by every profile the way the whisper.cpp binary itself is; only which
    // model a profile has chosen, and its language and microphone, are kept per profile — in experience settings.
    Pulsar = new PulsarService(
      app.getPath('userData'),
      app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'),
      (url, init) => net.fetch(url, init)
    )

    registerIpc()
    // The app's own browsing library (new-tab shortcuts, address-bar memory, reading list, pictures of pages); Chromium's
    // history, bookmarks and downloads are copied into it on demand.
    browserLibrary = new BrowserLibrary(app.getPath('userData'))
    await browserLibrary.load()
    registerLibraryIpc(browserLibrary, () => mainWindow, () => chromiumBrowser?.current ?? null)

    browserControl = setupBrowserControl({
      getWindow: () => mainWindow,
      store,
      onSettingsChanged: (settings) => {
        nativeTheme.themeSource = settings.theme
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:changed', settings)
      },
      browser: {
        open: async (input) => {
          if (!chromiumBrowser) return { ok: false, detail: NO_BROWSER }
          try {
            return await chromiumBrowser.open(input.slice(0, 2000), { newTab: true })
          } catch (err) {
            return { ok: false, detail: `The Orbis browser could not start: ${err instanceof Error ? err.message : String(err)}` }
          }
        },
        close: async () => void (await chromiumBrowser?.stop()),
        isOpen: () => Boolean(chromiumBrowser?.current),
        openWorkspace: async (tabs, groups, replace) => {
          if (!chromiumBrowser) throw new Error(NO_BROWSER)
          const service = await chromiumBrowser.ensure()
          return service.bridge.run(openWorkspaceScript(tabs as unknown as WorkspaceTabWanted[], groups as WorkspaceGroupWanted[], replace))
        }
      },
      resolvePage: (ctx) => {
        const service = chromiumBrowser?.current
        if (!service) throw new Error('The Orbis browser is not open. Open it first (browser.open).')
        return service.pages.resolve(ctx)
      }
    })

    // Profiles: separate browsing identities. Each has its own cookies, logins, site storage, history, bookmarks,
    // downloads and open pages; extensions are installed once and follow whichever profile is in use.
    const profilesStore = new ProfilesStore(app.getPath('userData'))

    /**
     * The password on the account.
     *
     * A separate credential from the vault's, deliberately: the vault's master password protects secrets the person put
     * there, and this protects the profile itself. They share `vault/crypto.ts` and nothing else.
     *
     * The profile id comes from the profile store, exactly as the vault's does. A window says which password to try; it
     * never says whose account to try it on.
     *
     * Made here, before the browser, because Tab Lock needs it: the account password is what can reset a forgotten tab
     * password, and a tab password made while the account is closed says honestly that it cannot be recovered.
     */
    const accounts = new AccountSecurity(app.getPath('userData'))
    app.on('before-quit', () => accounts.lock())
    // An account unlocked for one profile is not unlocked for another.
    profilesStore.onChange(() => accounts.lock())

    /**
     * Tab Lock: private tabs behind their own password.
     *
     * Set up before the browser starts, so the first tab listing the browser produces is already going through the
     * redaction point rather than a window in which a locked tab's address could be read.
     */
    /**
     * What Orbis records about its own security.
     *
     * Per profile, and narrow by construction: the shape an event may have has no field for an address, a page or a
     * credential, so this cannot leak one whatever is handed to it. It exists so somebody can notice something they did
     * not do.
     */
    const securityLog = new SecurityLog(app.getPath('userData'))
    const recordSecurity = (event: unknown): void => {
      void profilesStore
        .active()
        .then((p) => securityLog.record(p.id, event))
        .catch(() => undefined)
    }
    app.on('before-quit', () => void securityLog.flush())
    /*
     * The notification history, written before the process goes.
     *
     * And the one timer stopped. A pending burst holds a timer, and a timer that exists to say "your download
     * finished" is a timer that would otherwise keep a process alive after somebody has asked it to close.
     */
    app.on('before-quit', () => {
      notifications?.stop()
      void notifications?.flush()
    })
    profilesStore.onChange(() => void securityLog.flush())

    /**
     * Markets.
     *
     * One engine for the whole application, one store per profile, and providers registered into the engine rather than
     * reached for directly by anything that wants a price. Binance's public endpoints need no key and no account, which is
     * why real prices are there the first time Orbis is opened; anything that needs a licensed feed reports itself
     * unconfigured rather than showing a number nobody can stand behind.
     */
    const marketEngine = new MarketEngine()
    marketEngine.add(new BinanceProvider())
    // Futures are a second provider rather than a mode of the first: a different host, a different universe of symbols,
    // and prices that are not the spot prices. Registering it separately is what makes a perpetual impossible to confuse
    // with the spot market it tracks, because the instrument id says which one it is.
    marketEngine.add(new BinanceFuturesProvider())
    const marketsStore = new MarketsStore(app.getPath('userData'))
    const markets = new MarketsRuntime({
      engine: marketEngine,
      store: marketsStore,
      profileId: async () => (await profilesStore.active()).id,
      onAlert: ({ alert, value, instrument }) => {
        // Through the window's own notifications, not a second notification system.
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('markets:alert', {
            id: alert.id,
            label: alert.label,
            symbol: instrument?.symbol ?? '',
            value
          })
        }
      },
      /**
       * A market condition has just become true, and a workflow was waiting for it.
       *
       * The runtime decides *that* it happened; starting the workflow is the engine's job, through the same `run` every
       * other trigger uses. No second workflow engine, and no market logic inside the one there is.
       */
      onTrigger: ({ trigger, describe, instrumentId, value }) => {
        if (!workflowEngine) return
        void workflowEngine
          .run(trigger.workflowId, {
            trigger: 'event',
            inputs: { instrumentId, condition: describe, value }
          })
          .catch(() => {
            // A workflow that no longer exists, or one that refused to start. The trigger's own memory has already
            // advanced, so this does not retry in a loop -- and nothing is claimed to have run that did not.
          })
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('markets:trigger', { id: trigger.id, describe, instrumentId, value })
        }
      },
      onTickerChanged: (config) => {
        // The browser draws the strip, so it is the browser that is told whether to.
        const pages = chromiumBrowser?.current?.browser.list() ?? []
        for (const page of pages) {
          if (!page.getURL().startsWith('chrome://orbis-ticker')) continue
          void page.executeJavaScript('globalThis.orbisTickerChanged && globalThis.orbisTickerChanged()').catch(() => undefined)
        }
        void config
      }
    })
    /** Real exchange rates, from the European Central Bank's daily reference set. No key, and nowhere to put one. */
    const marketFx = new FxRates({ fetchFn: (url, init) => net.fetch(url as string, init as RequestInit) })
    /** The feed reader Markets borrows for its news: the same class the new tab's widget uses, with its cache and its backing off. */
    const marketNewsFeeds = new WidgetFeeds({ fetch: (url, init) => net.fetch(url, init), appVersion: app.getVersion() })
    void markets.start().catch(() => undefined)
    // The window's way in: this is where markets are set up. The strip only reads.
    // Moving a whole profile to another machine. Registered beside Markets because both need the active profile
    // and the window, and neither has anything else in common.
    registerPortableIpc({
      userData: app.getPath('userData'),
      profileId: async () => (await profilesStore.active()).id,
      getWindow: () => mainWindow,
      appVersion: app.getVersion()
    })

    registerMarketsIpc({
      engine: marketEngine,
      store: marketsStore,
      runtime: markets,
      getWindow: () => mainWindow,
      profileId: async () => (await profilesStore.active()).id,
      // One feed reader for the whole application. A second would be a second set of rate limits to get wrong.
      readFeed: (url) =>
        marketNewsFeeds
          .feed(url)
          .then((got) => (got.ok ? ({ ok: true, data: got.data } as const) : ({ ok: false, reason: got.reason } as const)))
          .catch(() => ({ ok: false, reason: 'That feed could not be read.' }) as const),
      fx: marketFx,
      /**
       * Where Orbis thinks the person is, for choosing a starting currency.
       *
       * The system locale and the region inside it. Electron knows this without asking anybody for anything, and it is
       * as much as choosing a currency needs -- there is deliberately no call here that would prompt for location.
       */
      detectionSignals: () => {
        const locale = app.getLocale() || app.getSystemLocale() || ''
        let region = ''
        try {
          region = new Intl.Locale(locale).maximize().region ?? ''
        } catch {
          region = ''
        }
        return { locale, region }
      }
    })
    /**
     * What Orion, the Orb, a workflow and a spoken command may do about markets.
     *
     * One registration for all four: Voice becomes a transcript, the transcript becomes an Orion request, and Orion, the
     * Orb and the workflow engine all reach Markets through the same capability registry. There is deliberately no
     * capability that could reach an exchange -- the only one that moves anything moves the paper account.
     */
    registerMarketCapabilities({
      control: browserControl.control,
      engine: marketEngine,
      store: marketsStore,
      runtime: markets,
      profileId: async () => (await profilesStore.active()).id,
      show: async (instrumentId, section) => {
        const window = mainWindow
        if (!window || window.isDestroyed()) return false
        // `markets:show`, not `markets:open`: the latter is already an invoke channel and already an event the strip
        // uses with a different shape. Two meanings on one channel is a bug waiting for whoever reads it next.
        window.webContents.send('markets:show', { instrumentId, section })
        // Brought forward as well: opening something nobody can see is not opening it.
        if (window.isMinimized()) window.restore()
        window.focus()
        return true
      }
    })
    profilesStore.onChange(() => void markets.profileChanged())
    app.on('before-quit', () => {
      markets.stop()
      void marketsStore.flush()
    })

    /**
     * Orbis Pages.
     *
     * The register is rebuilt from the build at every start, so a Page removed from a release cannot linger as an entry
     * that resolves to nothing. What a profile has *decided* -- permissions, favourites, each Page's saved work -- lives in
     * the store and is layered on, which is why the two are separate objects.
     */
    const pagesStore = new PagesStore(app.getPath('userData'))
    const generatedStore = new GeneratedStore(app.getPath('userData'), OPERATION_CAPABILITIES)
    /**
     * Pages somebody asked Orbis to build.
     *
     * Declared before the service and handed to it as a hook, because the two need each other in a circle: the
     * register has to include a profile's generated Pages, and building one has to look at the register first so it
     * does not build something that already exists.
     */
    let generated: GeneratedPages | null = null
    const pages = new PagesService({
      store: pagesStore,
      profileId: async () => (await profilesStore.active()).id,
      // Nothing is registered here yet. When a shared engine becomes a versioned dependency a Page can require, this is
      // where the build says which version it has -- and `compatibility` is what refuses a Page that needs a newer one.
      engines: {},
      generated: async (profileId) => (generated === null ? [] : generated.forRegistry(profileId))
    })
    searchOrbisPages = async (words: string) => {
      const profileId = (await profilesStore.active()).id
      return pageResults(await pages.state(profileId), words, profileId)
    }
    generated = new GeneratedPages({
      store: generatedStore,
      registry: (profileId) => pages.state(profileId),
      // The engines directly. What a generated Page is *allowed* to run is decided by its manifest, which the gates
      // check before this is ever called; this is the trial run, and the Page is not registered yet for a permission
      // check to be about.
      runOperation: (operation, input) => pages.carryOutFor(operation, input),
      allOperations: OPERATION_CAPABILITIES,
      apiKeys: async () => GROQ_API_KEYS,
      mistralKeys: () => MISTRAL_API_KEYS,
      fetchFn: (url, init) => net.fetch(url, init),
      random: () => crypto.randomUUID().replace(/-/g, ''),
      ask: requestJson,
      // A generated Page remembers what was typed into it. Orbis's decision, and the only capability the compiler
      // does not derive -- see the note at the top of `compiler.ts` about why it is a parameter rather than a field.
      allowStorage: true
    })
    pages.start()

    /*
     * Pages written as code, and the host that runs them.
     *
     * The host has existed since Pages did and nothing ever constructed it -- `rootFor` was declared and unsupplied,
     * so the whole sandbox sat there unreachable while Pages were rendered by the window instead. This is what it was
     * written for: a Page that is real files needs somewhere to be served from and a frame to be served into.
     *
     * Everything it is given here is already true of Pages: the same profile, the same service, the same permission
     * decisions. Nothing about the sandbox is relaxed for code -- that is the point of using this host rather than
     * inventing a second one.
     */
    const codeStore = new CodeStore({ userData: app.getPath('userData'), profileId: async () => (await profilesStore.active()).id })
    const pageHost = new PageHost({
      service: pages,
      profileId: async () => (await profilesStore.active()).id,
      rootFor: (pageId) => codeStore.rootFor(pageId),
      // What a code Page may reach. Generated code is never trusted, whoever wrote it, so it gets the plain grant set.
      trustFor: async () => 'generated',
      grantedFor: async () => []
    })
    pageHost.registerProtocol()
    /*
     * What a Page is allowed to ask for.
     *
     * Never called until now, so the set was empty and every `orbis.request` was refused as an unknown operation --
     * which is why a generated converter opened, looked right, and computed nothing. The Page's own code was fine;
     * there was simply nothing it was permitted to name.
     */
    setKnownOperations(Object.keys(OPERATION_CAPABILITIES))
    const codePages = new CodePages({
      host: pageHost,
      store: codeStore,
      apiKeys: async () => GROQ_API_KEYS,
      mistralKeys: () => MISTRAL_API_KEYS,
      fetchFn: (url, init) => net.fetch(url, init),
      ask: requestJson,
      random: () => crypto.randomUUID().replace(/-/g, '')
    })

    registerPagesIpc({
      service: pages,
      getWindow: () => mainWindow,
      profileId: async () => (await profilesStore.active()).id,
      generated,
      code: codePages
    })
    profilesStore.onChange(() => {
      pages.profileChanged()
      generated?.profileChanged()
    })

    /*
     * Things made from a request and kept as files.
     *
     * One store under the profile, one service with one operation map, one channel. The save dialog is the only
     * Electron piece and it is built here and handed in, so the service can be tested against a folder. Nothing in
     * this feature reports a file as made or saved until it has been read back from disk and checked.
     */
    const artifactStore = new ArtifactStore({ userData: app.getPath('userData') })
    const artifactGeneration = new ArtifactGeneration({
      apiKeys: async () => GROQ_API_KEYS,
      mistralKeys: () => MISTRAL_API_KEYS,
      fetchFn: (url, init) => net.fetch(url, init)
    })
    const artifacts = new ArtifactService({
      store: artifactStore,
      now: () => Date.now(),
      random: () => crypto.randomUUID().replace(/-/g, ''),
      chooseDestination: chooseDestinationWith(() => mainWindow),
      chooseSource: chooseSourceWith(() => mainWindow),
      renderPdf: renderPdfWith(),
      renderPng: renderPngWith(),
      downloadsDir: downloadsDirWith(),
      reveal: revealWith(),
      generation: artifactGeneration,
      // Reading the pictures of a scanned page. Nothing calls it without the person's yes for that file.
      see: seePicture,
      cannotSee: () => cannotDo('look', HAVE_KEYS),
      /*
       * Showing a project that is one web page.
       *
       * The same sandbox the generated Pages run in -- no network, no files, no Node, an opaque origin -- reached
       * through the one method on `CodePages` that takes code Orbis already has instead of asking a model for it.
       * Nothing is run on this computer by this or by anything it calls.
       */
      sandbox: {
        place: (spec, files) => codePages.adopt(spec, files),
        open: async (pageId) => {
          const window = mainWindow
          // No window, nothing to show it in. Said rather than thrown, because "it did not open" is the fact.
          if (!window || window.isDestroyed()) return { ok: false, error: 'no-window', message: 'There is no Orbis window to show the page in.' }
          return codePages.open(window, pageId)
        },
        close: (pageId) => void codePages.close(pageId)
      }
    })
    registerArtifactsIpc({
      /*
       * A file Orbis made, said only when nobody was watching it being made.
       *
       * Creating one from the chat means sitting in front of the thing that is making it; a notification for that is
       * telling somebody what is already on their screen. Away from Orbis, it is exactly what they wanted to know.
       */
      onMade: (what) => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused() && !mainWindow.isMinimized()) return
        void notifications?.publish({ type: 'artifact.created', fields: { filename: what.name, kind: what.kind, ...(what.path ? { path: what.path } : {}) } })
      },
      service: artifacts,
      getWindow: () => mainWindow,
      profileId: async () => (await profilesStore.active()).id
    })
    // Making things belongs to the chat. The Orb is for the browser, so nothing here is registered with it.
    artifactsForChat = { service: artifacts, chat: new ArtifactChat({ service: artifacts, generation: artifactGeneration }), profileId: async () => (await profilesStore.active()).id }
    app.on('before-quit', () => {
      void pagesStore.flush()
      void generatedStore.flush()
    })

    const tabLockStore = new TabLockStore(app.getPath('userData'), accounts)
    const tabLock = registerTabLockIpc({
      store: tabLockStore,
      control: browserControl.control,
      getWindow: () => mainWindow,
      send: (channel, ...args) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
      },
      profileId: async () => (await profilesStore.active()).id,
      tabs: async () =>
        (browserControl?.windowControl.state?.tabs ?? []).map((t) => ({ tabId: Number(t.id), url: t.url, title: t.title })),
      /**
       * The decision, carried into the browser.
       *
       * Read at call time rather than captured, because the browser is started later and restarted whenever the profile
       * changes. Failing to reach it is not an error worth stopping for: the tab is already locked everywhere this process
       * can enforce it, and the browser will be told again the next time anything changes.
       */
      // Profile Lock's, passed on: the Command Centre offers all three locking commands together and reaches Orbis
      // through one helper. `profileLock` is made just below, so this reads it at call time.
      lockProfile: () => profileLock.lockNow(),
      log: recordSecurity,
      tellBrowser: (tab) => {
        const pages = chromiumBrowser?.current?.browser.list() ?? []
        if (pages.length === 0) return
        void pushLock(pages, tab).catch(() => undefined)
      }
    })
    profilesStore.onChange(() => tabLock.profileChanged())
    app.on('before-quit', () => void tabLock.shutdown())

    /**
     * Profile Lock: Orbis itself, behind the account password.
     *
     * A different thing from Tab Lock and kept a different thing -- but they lock together, because a profile that has
     * locked with a tab left open would be a profile whose tabs were readable the moment it was unlocked by anybody who
     * had the account password. The account password is the recovery root for a tab password; it is not the tab password.
     */
    const profileLock = registerProfileLockIpc({
      accounts,
      getWindow: () => mainWindow,
      send: (channel, ...args) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
      },
      profileId: async () => (await profilesStore.active()).id,
      log: recordSecurity,
      onLocked: () => {
        // Everything protected, shut, and every tab password closed. The tabs themselves are untouched.
        tabLock.watcher.panic()
        tabLockStore.closeAll()
      }
    })
    profilesStore.onChange(() => profileLock.profileChanged())
    app.on('before-quit', () => profileLock.stop())

    /*
     * What Orion and automations may do about security.
     *
     * Every one of these either locks something or reports safely. There is no unlock capability: unlocking needs a
     * password, a password belongs to the person, and the most this layer can do about a locked tab is put its lock screen
     * in front of them.
     */
    registerSecurityCapabilities({
      control: browserControl.control,
      protectedTabs: () =>
        tabLock.watcher.all().map((t) => ({
          tabId: t.tabId,
          groupId: t.groupId,
          locked: t.locked,
          lockedBy: t.lockedBy,
          label: tabLock.watcher.policyFor(t.tabId).label
        })),
      groups: async () => {
        const id = (await profilesStore.active()).id
        return (await tabLockStore.groups(id)).map((g) => ({
          id: g.id,
          name: g.name,
          open: g.open,
          recoverable: g.recoverable
        }))
      },
      policyFor: (tabId) => tabLock.watcher.policyFor(tabId),
      policies: async () => {
        const id = (await profilesStore.active()).id
        return { tab: await tabLockStore.defaultPolicy(id), profile: await accounts.profileLock(id) }
      },
      describe: async (tabId) => {
        // The real tab, from the browser, described through `safeTabInfo`. If the browser is not up there is nothing to
        // describe -- which is different from a tab that exists and is hidden, so it answers null rather than a blank.
        const row = (browserControl?.windowControl.state?.tabs ?? []).find((t) => Number(t.id) === tabId)
        if (!row) return null
        return tabLock.watcher.describe({ tabId, url: row.url, title: row.title })
      },
      lockTab: (tabId) => tabLock.watcher.lock(tabId, 'manual'),
      lockAll: () => {
        const locked = tabLock.watcher.panic()
        tabLockStore.closeAll()
        return locked
      },
      lockProfile: () => profileLock.lockNow(),
      bringForward: async (tabId) => {
        // The browser's own capability, so bringing a tab forward is the same operation here as anywhere else -- and is
        // logged and switchable like any other.
        const done = await browserControl!.control.execute(
          { capability: 'tabs.activate', params: { tabId: String(tabId) }, target: {} },
          { source: 'user', confirm: async () => true }
        )
        return done.ok
      }
    })
    {
      const chromeExe = [process.env.ORBIS_CHROMIUM, app.isPackaged ? join(process.resourcesPath, 'chromium', 'chrome.exe') : 'C:/chromium/src/out/Default/chrome.exe'].find((p): p is string => Boolean(p) && existsSync(p as string))
      if (chromeExe) {
        chromiumBrowser = new FollowedBrowser({
          chrome: chromeExe,
          extensionSource: app.isPackaged ? join(process.resourcesPath, 'extension') : join(app.getAppPath(), 'extension'),
          dataDir: join(app.getPath('userData'), 'chromium'),
          profileId: async () => (await profilesStore.active()).id,
          apiKeys: () => GROQ_API_KEYS,
          // The keys for the models that can see; the helper runs its own requests and needs them, not a count.
          mistralKeys: () => MISTRAL_API_KEYS,
          adblockBundledDir: app.isPackaged ? join(process.resourcesPath, 'adblock') : join(app.getAppPath(), 'resources', 'adblock'),
          adblockListsDir: join(app.getPath('userData'), 'adblock'),
          personalDir: () => app.getPath('userData'),
          secrets: () => vaultForPanel,
          workflows: () => (workflowEngine ? { engine: workflowEngine, recorder: workflowRecorder ?? undefined, ...(workflowExtrasForPanel ?? {}) } : null),
          // The same library the Orbis window shows, not a second one over the same files: a skill learned here is the
          // skill the browser runs, and turning one off turns it off everywhere. Read at call time, because it is made
          // further down this same start-up.
          skills: () => (skillsForRuns ? { manager: skillsForRuns } : null),
          galaxy: () => galaxyForChat,
          appServices: () => appServicesForBrowser,
          // The Pages tab in the browser's own search page, answered from the same register the Pages screen uses.
          pages: () => (searchOrbisPages === null ? null : { search: searchOrbisPages }),
          /**
           * The things this person has made, for the "Made in Orbis" group on the browser's search page.
           *
           * It asks the library for its records through the one door it already has and ranks those. Nothing opens
           * an artifact, so no content can leave: a row carries a title, what the thing is, and one sentence Orbis
           * itself kept about it. It honours the same setting the address bar honours before drawing on anything
           * personal, and is absent when Orbis is not running -- which is the truth.
           */
          artifacts: () =>
            artifactsForChat === null
              ? null
              : {
                  search: async (query: string) => {
                    if ((await store.getSettings()).personalizedSuggestions === false) return []
                    const profileId = await artifactsForChat!.profileId()
                    const listed = await artifactsForChat!.service.run(profileId, { operation: 'artifact.list' })
                    if (!listed.ok) return []
                    const records = (listed.value as { record: ArtifactRecord }[]).map((one) => one.record)
                    return searchArtifacts(query, { list: () => records })
                  },
                  open: (artifactId: string) => {
                    if (!isArtifactId(artifactId)) return false
                    const window = mainWindow
                    if (!window || window.isDestroyed()) return false
                    // The same handoff the browser's Chat button makes, and then the screen to land on.
                    if (!embeddedBrowser) showBrowserWindow(false)
                    window.webContents.send('chromium:hide')
                    window.webContents.send('artifacts:show', artifactId)
                    if (window.isMinimized()) window.restore()
                    window.focus()
                    return true
                  }
                },
          searchSessions: () => searchSessionsForBrowser,
          // The reading index the browser's panel searches: the app's own, never a second one opened over the same file.
          /**
           * How Orbis looks, for the browser's own pages.
           *
           * The browser and the chat are two halves of one application, so a theme or a preset chosen in one belongs
           * in the other. Built by the same shared function the chat uses, so there is one idea of what a preset
           * means rather than two that drift, and read at call time so a change in Settings reaches an open browser.
           */
          appearance: () => {
            const config = experienceStore?.current()
            if (!config) return { variables: {}, backdrop: null }
            const still = wantsReducedMotion(config, nativeTheme.shouldUseDarkColors ? false : false)
            return {
              variables: appearanceVariables(config, still),
              backdrop: presetBackdrop(activePreset(config), still),
              /*
               * Whether the drifting starfield is on, which is the `effects` setting and not a preset.
               * The chat draws it from exactly this, so sending anything else would give the browser a different
               * answer to the same question.
               */
              field: settingsForBrowser?.effects !== false,
              still
            }
          },
          recall: () => recall,
          /**
           * Schedules, for the browser's panel and the Orb.
           *
           * The app's own store and scheduler, handed over rather than reopened, because two stores would mean two
           * answers to "what is scheduled" and the one nobody was looking at would be the wrong one. Read at call
           * time, since the browser can start before this does.
           *
           * Deliberately not everything: nothing here can switch on keeping Orbis running or waking the computer,
           * because those are decisions somebody makes in Settings with the wording in front of them.
           */
          schedules: () =>
            schedulesForChat
              ? {
                  all: () => schedulesForChat!.store.all(schedulesForChat!.profileId()),
                  add: (job) => schedulesForChat!.store.add(schedulesForChat!.profileId(), job, Date.now()),
                  pause: (jobId, until) => schedulesForChat!.store.pause(schedulesForChat!.profileId(), jobId, until),
                  resume: (jobId) => schedulesForChat!.store.resume(schedulesForChat!.profileId(), jobId, Date.now()),
                  remove: (jobId) => schedulesForChat!.store.remove(schedulesForChat!.profileId(), jobId),
                  skip: (jobId, dueAt) => schedulesForChat!.store.skipOccurrence(schedulesForChat!.profileId(), jobId, dueAt),
                  look: () => void schedulesForChat!.engine.tick()
                }
              : null,
          // Orbis has no account and nothing to sign in to. This is the name the person typed into the app, read fresh each
          // time so renaming yourself in the Orbis window renames you in the browser too, with no restart and no second identity.
          // The Chat button is on the browser's toolbar now, so this is how it gets back here.
          /**
           * The Chat button on the browser's own toolbar.
           *
           * Puts the browser away and brings the chat back. The browser keeps running with every tab where it was, so
           * coming back to it is one press and no reload -- which is the whole reason this hides rather than closes.
           *
           * The renderer is still told, because embedded mode has no separate window to hide and needs to collapse its
           * browser view instead.
           */
          showChat: () => {
            if (!embeddedBrowser) showBrowserWindow(false)
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('chromium:hide')
          },
          identity: async () => {
            const s = await store.getSettings()
            return { name: s.userName, title: s.userTitle }
          },
          // The introduction belongs to the installation, not to a browsing profile: adding or switching a profile must not
          // replay it. Recorded only when the browser page says it finished, so a crash partway through shows it again.
          intro: {
            seen: async () => (await store.getSettings()).introVersion,
            markSeen: async (version) => void (await store.updateSettings({ introVersion: version }))
          },
          // The app's own store, so a chat held in the panel and a chat held in the Orbis window are one chat.
          conversations: () => store,
          stores: () => panelStoresForBrowser,
          sidebar: () => {
            const store = browserSidebarForBrowser
            if (!store) return null
            const active = async (): Promise<string> => (await profilesStore.active()).id
            return { read: async () => store.read(await active()), write: async (layout) => store.write(await active(), layout), reset: async () => store.reset(await active()) }
          },
          control: browserControl?.control,
          // The browser's lock surface asks Orbis whether a password is right, because Orbis is what holds it. The
          // surface never sees a credential and never decides anything.
          tabLockHelper: () => tabLock.forHelper,
          // The market strip is a page, and pages reach Orbis through the helper.
          // The widgets on the start page, read at call time: see widgetsForBrowser.
          widgets: () => widgetsForBrowser,
          marketsHelper: () => ({
            tickerState: () => markets.tickerState(),
            nextBatch: () => markets.nextBatch(),
            prime: () => markets.prime(),
            act: async (what, instrumentId) => {
              // Every one of these is a real action. Nothing here reports success for something it did not do.
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('markets:open', { what, instrumentId })
                mainWindow.show()
                return true
              }
              return false
            },
            openGroups: async () => {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('markets:open', { what: 'ticker-groups', instrumentId: '' })
                mainWindow.show()
              }
            },
            /**
             * The close control on the strip, from the strip.
             *
             * One setting, and there are two strips reading it, so switching it off here switches off the one in the
             * Orbis window as well. That is the intent: it is the same strip in two places, not two features.
             */
            hideStrip: async () => {
              await markets.hideStrip()
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('markets:strip-changed')
              }
            }
          }),
          // Locked tabs never appear in a listing with their address, and the security layer follows the browser's own
          // tab events through `sync`.
          tabLock: {
            redactTabs: (rows) => tabLock.redactRows(rows),
            sync: (rows) => tabLock.sync(rows),
            restore: (rows) => tabLock.restore(rows.map((r) => ({ tabId: Number(r.id), url: r.url, title: r.title })))
          },
          saveDir: app.getPath('downloads'),
          clipboard: { readText: () => clipboard.readText(), hasImage: async () => (await clipboard.read().catch(() => [])).some((item) => item.types.includes('image/png')) },
          embedded: embeddedBrowser,
          // `--hide-crash-restore-bubble` because the embedded browser is not closed by a person clicking its close
          // button -- the Orbis window takes it down with it -- so Chromium decides it crashed and offers to restore
          // the pages. That bubble was appearing over a window the person never asked to see in the first place.
          chromeArgs: embeddedBrowser ? ['--orbis-embedded', '--hide-crash-restore-bubble'] : [],
          onStarted: (pid) => {
            if (embeddedBrowser) return embedController.attach(pid)
            /**
             * Its window, once Chromium has made one.
             *
             * Asked for a few times rather than once: the process exists before its window does, and how long that
             * takes is the machine's business. Failing to find it is not fatal -- the browser still works, it just
             * cannot be put away from here, which is better than refusing to start.
             */
            let tries = 0
            const look = (): void => {
              const hwnd = findBrowserWindow(pid)
              if (hwnd !== null) {
                try {
                  browserWindow = standaloneWindow(hwnd)
                } catch {
                  browserWindow = null
                }
                return
              }
              if (++tries < 40) setTimeout(look, 250)
            }
            look()
            /**
             * The chat is told the browser is running.
             *
             * So it can say so, and so it does not open a second one on launch when this one was started for it. It is
             * the running state being reported, not the window being shown: the browser goes on running while the chat
             * is in front, which is the whole point of hiding rather than closing.
             */
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('chromium:running', true)
          },
          onClosed: () => {
            browserWindow = null
            embedController.detach()
            browserControl?.windowControl.setState(closedBrowserState())
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('chromium:closed')
              mainWindow.webContents.send('chromium:running', false)
            }
          }
        }, (service) => {
          // Whenever the browser starts: the control layer's tab state follows its real tabs, and the app's copy of its history,
          // bookmarks and downloads is refreshed (at most once every few seconds) whenever those tabs change.
          let mirrored = 0
          const watcher = new SearchWatcher()

          /**
           * Reads the page in front into the index, when the rules say it counts as read.
           *
           * Deliberately reluctant. The browser reports its tabs whenever anything changes, and most of those moments
           * are not somebody reading: `shouldReadNow` refuses all of them except a tab that is in front, has finished
           * loading, has stayed there several seconds, and is not already in the index from the last hour. Only once
           * all of that holds does this cost a round trip into the browser for the text.
           *
           * Nothing here decides what may be *kept*: private tabs, blocked sites and sign-in pages are the store's
           * rules, checked again when the text arrives. This only decides when to bother looking.
           */
          const frontTab = new FrontTabWatch()
          const captureFrontPage = async (running: typeof service): Promise<void> => {
            if (!recall) return
            const settings = recall.settings()
            if (!settings.enabled) {
              frontTab.reset()
              return
            }
            const tabs = browserControl?.windowControl.state?.tabs ?? []
            const front = tabs.find((t) => t.active)
            const now = Date.now()
            const inFrontSince = frontTab.saw(
              front && { id: front.id, active: true, url: front.url, title: front.title, loading: front.loading === true, private: front.private === true },
              now
            )
            if (!front) return

            const verdict = shouldReadNow(
              { id: front.id, active: true, url: front.url, title: front.title, loading: front.loading === true, private: front.private === true },
              settings,
              { now, inFrontSince, lastIndexedAt: recall.visitedAt(front.url) }
            )
            if (!verdict.read) return

            const read = await running.control.execute(
              { capability: 'page.read', params: { maxChars: MAX_PAGE_TEXT }, source: 'user' },
              { confirm: async () => true }
            )
            if (!read.ok) return
            const page = read.data as { url: string; title: string; text: string; loading?: boolean }
            /**
             * The address is checked again against the tab it was read from.
             *
             * A page that navigated between the decision and the read would otherwise be stored under the old address,
             * which is the one way this could put the wrong text against a page somebody actually read.
             */
            if (pageKey(page.url) !== pageKey(front.url)) return
            recall.remember({ url: page.url, title: page.title || front.title, text: page.text }, { loading: page.loading === true })
          }
          const refreshMirror = (): void => {
            // A search made in the browser is remembered like one typed in the Orbis address bar, unless suggestions from what the
            // person searched are off or the tab is private.
            const state = browserControl?.windowControl.state
            const searched = watcher.next((state?.tabs ?? []).map((t) => ({ id: t.id, url: t.url, private: t.private })))
            if (searched.length && browserLibrary) {
              const library = browserLibrary
              void store.getSettings().then((settings) => {
                if (settings.personalizedSuggestions !== false) for (const query of searched) library.recordSearch(query)
              })
            }
            /**
             * Reading the page in front into the index, if this person asked for that.
             *
             * On the same feed as the mirror because it is the same question -- the browser has told us its tabs
             * changed -- but on its own clock: the mirror is throttled to once every three seconds, and a page has to
             * have been in front for longer than that before it counts as read at all.
             */
            void captureFrontPage(service).catch(() => undefined)

            if (!browserLibrary || Date.now() - mirrored < 3000) return
            mirrored = Date.now()
            void mirrorChromiumInto(browserLibrary, service).catch(() => undefined)
          }
          registerBrowserExtras({ control: service.control, windowControl: browserControl!.windowControl, bridge: service.bridge })
          void followChromiumTabs(service, browserControl!.windowControl, refreshMirror).catch((err: unknown) => console.error('[browser] could not follow tabs', err))
        }, () => browserControl?.windowControl.setState(closedBrowserState()))
        app.on('before-quit', () => void chromiumBrowser?.stop())
        profilesStore.onChange(() => void chromiumBrowser?.profileMayHaveChanged())
      }
    }
    // Conversations belong to the profile in use. The window is told to read them again whenever that changes.
    const reloadConversations = (): void => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('conversations:reload')
    }
    store.useProfile((await profilesStore.active()).id)
    reloadConversations()
    profilesStore.onChange(() => {
      void profilesStore.active().then((profile) => {
        store.useProfile(profile.id)
        reloadConversations()
      })
    })

    // Workflows: stored, versioned, recorded and run through the Browser Control Layer.
    const sendToWindow = (channel: string, ...args: unknown[]): void => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
    }
    const fetchForOrion = (url: string, init?: RequestInit): Promise<Response> => net.fetch(url, init)
    // Workflows, and the learned skills built on them, belong to the profile that made them.
    const workflowStore = new WorkflowStore(app.getPath('userData'), platform().secrets, (await profilesStore.active()).id)
    workflowRecorder = new ChromiumRecorder({
      getChromium: () => (chromiumBrowser ? chromiumBrowser.ensure() : Promise.reject(new Error(NO_BROWSER))),
      emit: (state) => sendToWindow('workflows:recording', state)
    })
    const workflows = new WorkflowEngine({
      control: browserControl.control,
      windowControl: browserControl.windowControl,
      store: workflowStore,
      library: browserLibrary!,
      ask: (request, signal) => askOrion(request, GROQ_API_KEYS, fetchForOrion, signal),
      // Everything the engine tells the windows, the rules hear about too -- so a rule about a workflow answers when
      // the workflow changes rather than up to half a minute later, and the interval is only for readings that nothing
      // announces. The watcher is built further down this same startup; until it exists there is nothing watching.
      send: (channel: string, ...args: unknown[]) => {
        sendToWindow(channel, ...args)
        void ruleWatcher?.look()
      },
      /*
       * A workflow finished, or could not.
       *
       * Published as an event, never shown from here. Whether it is worth interrupting somebody for, how urgent it
       * is, whether it is three in the morning and whether the same thing has already been said are all one decision
       * made in one place (src/main/notifications), and this is one of the things that reports to it.
       */
      notify: (title, body) => {
        void notifications?.publish({ type: 'workflow.completed', fields: { name: title, summary: body } })
      }
    })
    workflowEngine = workflows
    /**
     * Naming workflows. Orion names them the way it names chats, so nobody has to name every one they make; the work
     * happens after the workflow is already saved and usable, and never holds anything up.
     */
    const workflowTitler = new WorkflowTitler({
      get: (workflowId) => workflows.get(workflowId),
      save: (workflow) => workflowStore.save(workflow, 'Named by Orion'),
      ask: (context) => generateWorkflowTitle(context, GROQ_API_KEYS, fetchForOrion),
      announce: () => sendToWindow('workflows:changed')
    })
    workflows.onStored = (workflow) => workflowTitler.onSaved(workflow)
    app.on('before-quit', () => workflowTitler.stop())

    registerWorkflowIpc({
      engine: workflows,
      recorder: workflowRecorder!,
      store: workflowStore,
      control: browserControl.control,
      getWindow: () => mainWindow,
      draft: async (instruction, current) =>
        draftValidatedWorkflow(instruction, current, browserControl!.control.list(), GROQ_API_KEYS, fetchForOrion, () => crypto.randomUUID(), await workflowStore.list()),
      regenerateTitle: (workflowId) => workflowTitler.regenerate(workflowId)
    })
    workflowExtrasForPanel = {
      store: workflowStore,
      draft: async (instruction, current) =>
        draftValidatedWorkflow(instruction, current, browserControl!.control.list(), GROQ_API_KEYS, fetchForOrion, () => crypto.randomUUID(), await workflowStore.list())
    }
    void workflows.start().catch((err: unknown) => console.error('[workflows] failed to start', err))
    profilesStore.onChange(() => {
      void profilesStore
        .active()
        .then((profile) => workflows.useProfile(profile.id))
        .catch((err: unknown) => console.error('[workflows] could not switch profile', err))
    })
    app.on('before-quit', () => workflows.stop())



    // The Experience Runtime: everything the user personalises, kept apart from Orbis's own settings so the browser
    // works exactly as it always has until someone chooses otherwise.
    // Named locally as well, so everything below keeps a value the compiler can see is there while the module-level
    // one stays available to the things that interrupt long after this has run.
    const experience = new ExperienceStore(app.getPath('userData'), (await profilesStore.active()).id)
    experienceStore = experience
    await experience.load().catch((err: unknown) => console.error('[experience] could not be read', err))

    /*
     * The notification system.
     *
     * Built here because it reads its settings from the store above. Everything it can do when somebody presses a
     * notification is decided now, in one table, and nothing can be added to it later -- a notification carries the
     * name of an action and the ids of what it is about, never anything that could become a command.
     */
    notifyProfileId = (await profilesStore.active()).id
    // Notifications follow the person: switching profile changes whose history is read and whose is written to.
    profilesStore.onChange(() => void profilesStore.active().then((p) => void (notifyProfileId = p.id)))
    notifications = createNotifications({
      userData: app.getPath('userData'),
      profileId: () => notifyProfileId,
      settings: () => experience.current().notifications,
      /*
       * What Orbis knows about where somebody's attention is.
       *
       * Only two things, and both are facts rather than guesses: whether an Orbis window is in front, and what the
       * window last said it was showing. A notification about the thing already on the screen is noise.
       */
      attention: () => ({ focused: mainWindow?.isFocused() === true && !mainWindow.isMinimized(), watching: watchingNow }),
      handlers: {
        open: async (one: { id: string; event: string; subject: Readonly<Record<string, string>> }) => {
          if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, message: 'Orbis has no window open.' }
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
          // The window decides where that is. The list of places a notification can send somebody is the list of
          // screens Orbis has, and a notification only ever says which event it was about.
          sendToWindow('notifications:open', { id: one.id, event: one.event, subject: one.subject })
          return { ok: true }
        },
        openFile: async (path: string) => {
          const problem = await shell.openPath(path)
          return problem === '' ? { ok: true } : { ok: false, message: problem }
        },
        showInFolder: async (path: string) => {
          shell.showItemInFolder(path)
          return { ok: true }
        }
      },
      onChange: () => sendToWindow('notifications:changed')
    })

    /*
     * Downloads, from the browser's own account of them.
     *
     * The template for these existed and nothing published the event, so a download finishing while somebody was in
     * another application said nothing. It is Chromium's own state -- `complete` or `interrupted` -- rather than a
     * file appearing on disk, because a half-written download is also a file and only the browser knows the
     * difference. The path travels with it so "Open" and "Show in folder" have something real to open.
     */
    bus.subscribe({ names: ['download.completed', 'download.failed'] }, (event) => {
      const one = event.detail as { filename?: string; path?: string; reason?: string }
      void notifications?.publish({
        type: event.name === 'download.completed' ? 'download.completed' : 'download.failed',
        fields: { filename: one.filename ?? 'A file', ...(one.path ? { path: one.path } : {}), ...(one.reason ? { reason: one.reason } : {}) }
      })
    })
    // Personalisation follows the profile: the widgets on the new tab, what each is set to, the wallpaper and the theme
    // all belong to whoever is using Orbis, and switching profile swaps all of it rather than sharing it.
    profilesStore.onChange(() => {
      void profilesStore
        .active()
        .then((profile) => experience.useProfile(profile.id))
        .catch((err: unknown) => console.error('[experience] could not switch profile', err))
    })
    /**
      * The one place the start page's widgets are changed, over the store that already keeps them.
      *
      * Orion's widget capabilities and the browser's start page both go through this, so a widget added by either is
      * added once, in one place, and read back before anybody is told it is there.
      */
    const widgetRuntime = createWidgetRuntime({ store: experience })
    registerExperienceIpc({ store: experience, control: browserControl.control, widgets: widgetRuntime, getWindow: () => mainWindow, send: sendToWindow })
    app.on('before-quit', () => void experience.flush())

    /**
     * "Tell me when..."
     *
     * The rules were stored, cleaned and versioned, and nothing had ever asked them anything. This is what asks. It
     * reads what the Workflow Engine is really doing, hands it to the rules, and shows whatever they say -- through the
     * same notification settings as everything else, so quiet hours and the category switches hold here too.
     *
     * The readings come from `activeRuns()`, which is the engine's own account of its own runs. Nothing is synthesised:
     * when nothing is running there are no readings at all, and a rule with nothing to compare stays quiet.
     */
    const watcher = new RuleWatcher({
      read: () => workflowReadings(workflows.activeRuns()),
      rules: () => experience.current().rules,
      notifications: () => experience.current().notifications,
      // Written only when a rule has actually learned something -- which is why the watcher compares by value rather
      // than by identity. Saving goes through the same store as every other change, so the windows do hear about it;
      // that is acceptable because it happens when a rule's answer changes, not on every look.
      remember: async (rules) => {
        await experience.save({ ...experience.current(), rules }, 'Rules').catch((err: unknown) => {
          // A rule that could not write down what it saw may say the same thing twice after a restart. That is worth a
          // line in the log and nothing more; it must not stop the rule working now.
          console.error('[rules] could not be written', err)
        })
      },
      // A rule that has become true. The lowest kind of noise Orbis makes, which is why it says so rather than deciding.
      notify: (title, body) => {
        void notifications?.publish({ type: 'rule.fired', fields: { name: title, detail: body } })
      }
    })
    ruleWatcher = watcher
    void watcher.start()
    app.on('before-quit', () => watcher.stop())

    // Updating Orbis. Created once the window is on its way, and it looks for a release in the background rather than
    // holding anything up. The endpoint comes from the build, so a released Orbis never asks a development server.
    updates = new UpdateManager({
      directory: join(app.getPath('userData'), 'updates'),
      currentVersion: app.getVersion(),
      installDirectory: dirname(app.getPath('exe')),
      executablePath: app.getPath('exe'),
      platform: process.platform as 'win32' | 'darwin' | 'linux',
      arch: process.arch,
      endpoint: process.env.ORBIS_UPDATE_URL ?? UPDATE_ENDPOINT,
      pid: process.pid,
      quit: () => {
        // Everything is written out before Orbis goes; the installer waits for this process to end.
        updatesQuitting = true
        app.quit()
      },
      spawnDetached: async (command, args) => {
        const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
        child.unref()
      },
      // An update only counts as having worked if the user's profiles are still there afterwards.
      profilesReadable: async () => {
        try {
          await profilesStore.list()
          return true
        } catch {
          return false
        }
      }
    })
    updates.on('changed', (status) => mainWindow?.webContents.send('update:changed', status))
    /*
     * An update that is ready, said once.
     *
     * Only `ready-to-install`: an update being available, downloading or verifying is Orbis's business, and the one
     * moment that is the person's is when it is waiting for them to restart. The version is the deduplication key, so
     * a state that is reported several times -- and it is, on every progress change -- still says this once, and the
     * next version says it again.
     */
    updates.on('changed', (status) => {
      if (status.state !== 'ready-to-install') return
      void notifications?.publish({ type: 'update.ready', fields: { version: status.available?.version ?? '' } })
    })
    void updates.start().catch((err: unknown) => console.error('[updates] failed to start', err))
    /** Points the app at a profile's own data. The browser follows the profile through its own data folder (see BrowserManager). */
    const useProfile = async (profile: Profile): Promise<Profile> => {
      await browserLibrary?.useDirectory(profilesStore.dataDir(profile.id))
      sendToWindow('profiles:changed', { profile })
      return profile
    }
    const switchProfile = async (id: string): Promise<{ profile: Profile }> => {
      const profile = await profilesStore.setActive(id)
      await useProfile(profile)
      return { profile }
    }
    const startingProfile = await profilesStore.active()
    if (startingProfile.id !== 'default') await useProfile(startingProfile).catch((err: unknown) => console.error('[profiles] could not start in the last profile', err))

    // Notes, tasks and clipboard history: the user's own things, kept locally and reachable from the control layer.
    const notesStore = new NotesStore(app.getPath('userData'))
    const tasksStore = new TasksStore(app.getPath('userData'))
    const whiteboardStore = new WhiteboardStore(app.getPath('userData'))
    const workspacesStore = new WorkspacesStore(app.getPath('userData'))
    // Notes, tasks, whiteboards and workspaces belong to the profile in use, like its browsing and its workflows.
    const personalStores = [notesStore, tasksStore, whiteboardStore, workspacesStore]
    const followProfile = (): Promise<void> =>
      profilesStore
        .active()
        .then((profile) => Promise.all(personalStores.map((store) => store.useProfile(profile.id))))
        .then(() => undefined)
        .catch((err: unknown) => console.error('[personal] could not switch profile', err))
    await followProfile()
    profilesStore.onChange(() => void followProfile())
    // How this profile has arranged the browser sidebar. Kept with the profile, because a work life and a personal one
    // have no reason to share which panels are to hand.
    /**
     * The secrets vault, one per profile.
     *
     * The vault key never leaves this process and the window never receives it. Everything below takes the profile
     * from the profile store rather than from the window, so a window cannot ask for another profile's vault.
     */
    const vault = new SecretsVault(app.getPath('userData'))
    const vaultProfile = async (): Promise<string> => (await profilesStore.active()).id
    vault.whenLocked(() => sendToWindow('vault:locked'))
    vaultForPanel = secretsFromVault(vault, vaultProfile)
    app.on('before-quit', () => vault.lock())
    // Switching profile takes the vault with it: a vault unlocked for one profile is not unlocked for another.
    profilesStore.onChange(() => vault.lock())

    const vaultCall = <T,>(run: (profileId: string) => Promise<T> | T): ((event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T | { error: string }>) => {
      return async (event) => {
        if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
        try {
          return await run(await vaultProfile())
        } catch (err) {
          // The reason travels as a code the window can act on; nothing of the vault ever does.
          return { error: err instanceof VaultFailure ? err.code : 'io' }
        }
      }
    }
    const str = (value: unknown, max = 4096): string => (typeof value === 'string' ? value.slice(0, max) : '')

    const accountCall = <T,>(run: (profileId: string) => Promise<T> | T): ((event: IpcMainInvokeEvent) => Promise<T | { error: string; message?: string; waitMs?: number }>) => {
      return async (event) => {
        if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
        try {
          return await run(await vaultProfile())
        } catch (err) {
          // A code the window can act on, and a sentence it can show. Never anything of the credential itself.
          if (err instanceof AccountFailure) return { error: err.code, message: err.message, waitMs: err.waitMs }
          return { error: 'io' }
        }
      }
    }

    ipcMain.handle('account:status', accountCall((id) => accounts.status(id)))
    ipcMain.handle('account:create', (event, password: unknown, name: unknown) =>
      accountCall(async (id) => {
        await accounts.create(id, str(password, 256), str(name, 80))
        recordSecurity({ kind: 'ACCOUNT_CREATED' })
        return accounts.status(id)
      })(event)
    )
    ipcMain.handle('account:unlock', (event, password: unknown) =>
      accountCall(async (id) => {
        try {
          await accounts.unlock(id, str(password, 256))
        } catch (err) {
          // Recorded, because somebody finding attempts they did not make is the whole reason the log exists. What is
          // recorded is that one was wrong -- never what was tried.
          if (err instanceof AccountFailure && err.code === 'wrong-password') {
            recordSecurity({ kind: 'FAILED_ACCOUNT_UNLOCK' })
          }
          throw err
        }
        recordSecurity({ kind: 'ACCOUNT_UNLOCKED' })
        // Somebody has just been here and typed a password into this window, so the idle and focus clocks start again from
        // now rather than from whenever they last ran.
        profileLock.unlocked()
        return accounts.status(id)
      })(event)
    )
    ipcMain.handle('account:lock', accountCall(async (id) => {
      accounts.lock()
      return accounts.status(id)
    }))
    ipcMain.handle('account:verify', (event, password: unknown) =>
      accountCall(async (id) => ({ ok: await accounts.verify(id, str(password, 256)) }))(event)
    )
    ipcMain.handle('account:change', (event, current: unknown, next: unknown, name: unknown) =>
      accountCall(async (id) => {
        await accounts.change(id, str(current, 256), str(next, 256), str(name, 80))
        recordSecurity({ kind: 'ACCOUNT_PASSWORD_CHANGED' })
        return accounts.status(id)
      })(event)
    )

    // The security log: read and cleared, and nothing else. There is no channel that writes one -- events are recorded by
    // the code that does the thing, so a window cannot put an event in the log that did not happen.
    ipcMain.handle('security:log', accountCall((id) => securityLog.all(id)))
    ipcMain.handle('security:clear-log', accountCall(async (id) => {
      await securityLog.clear(id)
      return { ok: true }
    }))

    ipcMain.handle('vault:status', vaultCall((id) => vault.status(id)))
    ipcMain.handle('vault:question', vaultCall((id) => vault.recoveryQuestion(id)))
    ipcMain.handle('vault:create', (event, password: unknown, recovery: unknown) =>
      vaultCall(async (id) => {
        const r = (recovery ?? {}) as { question?: unknown; answer?: unknown }
        await vault.create(id, str(password), str(r.question) && str(r.answer) ? { question: str(r.question, 300), answer: str(r.answer) } : undefined)
        return vault.status(id)
      })(event)
    )
    ipcMain.handle('vault:unlock', (event, password: unknown) =>
      vaultCall(async (id) => {
        await vault.unlock(id, str(password))
        return vault.status(id)
      })(event)
    )
    ipcMain.handle('vault:lock', vaultCall(async (id) => {
      vault.lock()
      return vault.status(id)
    }))
    ipcMain.handle('vault:list', vaultCall((id) => vault.list(id)))
    ipcMain.handle('vault:reveal', (event, secretId: unknown) => vaultCall((id) => vault.reveal(id, str(secretId, 80)))(event))
    ipcMain.handle('vault:add', (event, secret: unknown) => vaultCall((id) => vault.add(id, secret))(event))
    ipcMain.handle('vault:update', (event, secretId: unknown, secret: unknown) => vaultCall((id) => vault.update(id, str(secretId, 80), secret))(event))
    ipcMain.handle('vault:remove', (event, secretId: unknown) => vaultCall((id) => vault.remove(id, str(secretId, 80)))(event))
    ipcMain.handle('vault:change-password', (event, current: unknown, next: unknown) =>
      vaultCall(async (id) => {
        await vault.changeMasterPassword(id, str(current), str(next))
        return vault.status(id)
      })(event)
    )
    ipcMain.handle('vault:set-recovery', (event, password: unknown, recovery: unknown) =>
      vaultCall(async (id) => {
        const r = recovery as { question?: unknown; answer?: unknown } | null
        await vault.setRecovery(id, str(password), r && str(r.question) && str(r.answer) ? { question: str(r.question, 300), answer: str(r.answer) } : null)
        return vault.status(id)
      })(event)
    )
    ipcMain.handle('vault:recover', (event, answer: unknown, password: unknown) =>
      vaultCall(async (id) => {
        await vault.recover(id, str(answer), str(password))
        return vault.status(id)
      })(event)
    )
    ipcMain.handle('vault:auto-lock', (event, password: unknown, ms: unknown) =>
      vaultCall(async (id) => {
        await vault.setAutoLock(id, str(password), typeof ms === 'number' ? ms : 0)
        return vault.status(id)
      })(event)
    )
    ipcMain.handle('vault:destroy', (event, password: unknown) =>
      vaultCall(async (id) => {
        await vault.destroy(id, str(password))
        return vault.status(id)
      })(event)
    )

    /**
     * Goals worked through one step at a time.
     *
     * Not a second automation engine: every step is a control-layer command, run the same way and verified the same
     * way as anything else Orbis does. What is different is where the plan comes from — Orion is asked for the next
     * step only, in front of the page it applies to, and asked again once Orbis has looked at what happened.
     *
     * Runs are per profile and are not kept across restarts: a half-finished run resumed against a page that has
     * since changed is worse than no run at all.
     */
    const stepRuns = new Map<string, StepRun>()
    const countedRuns = new Set<string>()
    let skillsForRuns: SkillManager | null = null
    const stepProfile = async (): Promise<string> => (await profilesStore.active()).id

    /** The active tab's page in the Orbis browser, for reading signals from. Null when the browser is closed or the tab has no page. */
    const activePage = (target?: { tabId?: string; webContentsId?: number }): PageHandle | null => {
      const state = browserControl?.windowControl.state
      const id = target?.webContentsId ?? (target?.tabId ? state?.tabs.find((t) => t.id === target.tabId)?.webContentsId : state?.tabs.find((t) => t.active)?.webContentsId)
      return typeof id === 'number' ? (chromiumBrowser?.current?.agent.findPage(id) ?? null) : null
    }

    const makeStepRun = (id: string, profileId: string, goal: string): StepRun =>
      new StepRun(
        { id, profileId, goal },
        {
          execute: async (command, runId) =>
            browserControl!.control.execute(
              { capability: command.capability, params: command.params, target: command.target, source: 'automation' },
              // A step-by-step run acts for the person but is not the person: whatever a capability says needs confirming
              // is asked in the window, exactly as it is for workflows.
              { source: 'automation', runId, confirm: (request) => browserControl!.windowControl.confirm(request) }
            ),
          signals: async (target) => {
            const wc = activePage(target)
            // No page is not a challenge. Saying otherwise would stop runs for the wrong reason.
            return wc ? readSignals(wc) : { url: '' }
          },
          observe: async () => {
            const result = await browserControl!.control.execute(
              { capability: 'page.read', params: {}, source: 'automation' },
              { source: 'automation', confirm: async () => true }
            )
            if (!result.ok) return 'The page could not be read.'
            const data = result.data as { url?: string; title?: string; text?: string } | undefined
            return [data?.title, data?.url, data?.text].filter(Boolean).join('\n').slice(0, 20_000) || 'The page is empty.'
          },
          plan: (request) => planNextStep(request, browserControl!.control.list({}), GROQ_API_KEYS, fetchForOrion),
          emit: (view) => {
            // A goal that finished well is counted once, so doing the same thing again can be pointed out.
            if (view.session.status === 'done' && !countedRuns.has(view.session.id)) {
              countedRuns.add(view.session.id)
              void skillsForRuns?.countSuccess(view.session.goal).catch(() => undefined)
            }
            sendToWindow('steps:changed', view)
          },
          newId: () => crypto.randomUUID()
        }
      )

    /** Only the Orbis window may drive a run, and only ever one of its own profile's. */
    const stepCall = <T,>(run: (current: StepRun | undefined, profileId: string) => Promise<T> | T) => {
      return async (event: IpcMainInvokeEvent, runId: unknown): Promise<T | null> => {
        if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
        const profileId = await stepProfile()
        const found = typeof runId === 'string' ? stepRuns.get(runId) : undefined
        return run(found && found.state.profileId === profileId ? found : undefined, profileId)
      }
    }

    ipcMain.handle('steps:start', async (event, goal: unknown) => {
      if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
      const task = typeof goal === 'string' ? goal.trim().slice(0, 2000) : ''
      if (!task) return null
      const id = crypto.randomUUID()
      const run = makeStepRun(id, await stepProfile(), task)
      stepRuns.set(id, run)
      // Started in the background: the window watches it through steps:changed rather than waiting on this call.
      void run.start().catch(() => undefined)
      return run.view()
    })
    ipcMain.handle('steps:read', stepCall((run) => run?.view() ?? null))
    ipcMain.handle('steps:pause', stepCall((run) => {
      run?.pauseRun('Paused by you.')
      return run?.view() ?? null
    }))
    ipcMain.handle('steps:resume', stepCall(async (run) => {
      await run?.resumeRun()
      return run?.view() ?? null
    }))
    ipcMain.handle('steps:stop', stepCall((run) => {
      run?.stopRun('Stopped by you.')
      return run?.view() ?? null
    }))
    ipcMain.handle('steps:skip', stepCall(async (run) => {
      await run?.skipCurrent('You chose to skip this.')
      return run?.view() ?? null
    }))
    // The person says they have dealt with a challenge. The page is looked at before that is believed.
    ipcMain.handle('steps:verified', stepCall(async (run) => {
      await run?.captchaDone()
      return run?.view() ?? null
    }))

    /**
     * Learned skills: successful step-by-step runs the person chose to keep, stored per profile beside its workflows and
     * run by the workflow engine like any workflow. Only the Orbis window may ask for any of this.
     */
    const skills = new SkillManager({
      userData: app.getPath('userData'),
      profileId: await stepProfile(),
      capabilities: () => browserControl!.control.list({}),
      workflows,
      announce: () => sendToWindow('skills:changed')
    })
    skillsForRuns = skills
    profilesStore.onChange(() => {
      void stepProfile().then((id) => skills.useProfile(id))
    })
    const fromWindow = (event: IpcMainInvokeEvent): void => {
      if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
    }
    const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')
    const edits = (value: unknown): SkillEdits => {
      const v = (value ?? {}) as Record<string, unknown>
      return {
        ...(typeof v.name === 'string' ? { name: v.name } : {}),
        ...(typeof v.whenToUse === 'string' ? { whenToUse: v.whenToUse } : {}),
        ...(typeof v.category === 'string' ? { category: v.category } : {}),
        ...(Array.isArray(v.domains) ? { domains: v.domains.filter((d): d is string => typeof d === 'string') } : {})
      }
    }
    /** The run itself, in the main process, and only if it belongs to the profile in use. */
    const ownRun = async (runId: unknown): Promise<StepRun> => {
      const run = typeof runId === 'string' ? stepRuns.get(runId) : undefined
      if (!run || run.state.profileId !== (await stepProfile())) throw new Error('That run is no longer available.')
      return run
    }
    /** Memory: per profile, on this computer. Only the Orbis window may read or change it. */
    memory = new MemoryStore(app.getPath('userData'), await stepProfile())
    memory.onChange(() => sendToWindow('memory:changed'))
    profilesStore.onChange(() => {
      void stepProfile().then((id) => memory?.useProfile(id))
    })
    app.on('before-quit', () => memory?.close())
    const memoryCall = <T,>(run: (store: MemoryStore, ...args: unknown[]) => T) => (event: IpcMainInvokeEvent, ...args: unknown[]): T => {
      if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
      return run(memory!, ...args)
    }
    const category = (value: unknown): MemoryCategory | undefined => (['about', 'preference', 'project', 'general'].includes(String(value)) ? (value as MemoryCategory) : undefined)
    /**
     * The pages this person has read, per profile, on this computer.
     *
     * Off until switched on, and the switch is in settings with the wording beside it. Only the Orbis window may read
     * it or delete from it; nothing here can switch it on for somebody, which is deliberate.
     */
    recall = new RecallStore(app.getPath('userData'), await stepProfile())
    profilesStore.onChange(() => {
      void stepProfile().then((id) => recall?.useProfile(id))
    })
    app.on('before-quit', () => recall?.close())
    registerRecallIpc({
      store: recall,
      profileId: stepProfile,
      handle: (channel, run) => {
        ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
          if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
          return run(await stepProfile(), ...args)
        })
      },
      broadcast: (channel, payload) => sendToWindow(channel, payload)
    })

    /**
     * Schedules: the clock above the engines that already do the work.
     *
     * Everything it can do needs this computer awake with Orbis running, because there is no Orbis server. That is
     * said out loud rather than hidden -- `schedules:capabilities` is the one place any screen asks -- and nothing
     * here pretends otherwise by, say, queueing something for a machine that is off.
     */
    const schedules = new TemporalStore(app.getPath('userData'))
    app.on('before-quit', () => void schedules.flush())

    const deviceNow = (): DeviceState => ({
      orbisRunning: true,
      browserRunning: chromiumBrowser?.isRunning ?? false,
      networkAvailable: net.isOnline(),
      /**
       * Whether the connection is metered is not something Orbis can find out here.
       *
       * So "only on wifi" is treated as "only when connected", and the limitation is written down in `UNSUPPORTED`
       * rather than left as a switch that appears to work and does nothing.
       */
      onUnmeteredNetwork: net.isOnline(),
      onPower: !powerMonitor.onBatteryPower,
      /*
       * Electron does not report a charge level, and a made-up number is worse than none: null means "no battery
       * check is possible", which `conditionsMet` treats as satisfied rather than as a flat battery.
       */
      batteryPercent: null,
      idle: powerMonitor.getSystemIdleTime() > 300,
      hasModelKey: GROQ_API_KEYS.length > 0,
      // Read from the vault rather than remembered, so removing the token takes effect on the next pass.
      hasTelegramToken: telegramToken() !== null
    })

    /**
      * The Telegram bot token, read at the moment of sending rather than remembered.
      *
      * Read rather than held, so removing it from the vault takes effect at once and so no copy of it lives in a
      * variable for the life of the process. A locked vault is reported as locked, which the scheduler treats as
      * something waiting to be unlocked rather than a failure to work around.
      */
    const telegramToken = (): { token: string } | { token: null; because: 'locked' | 'missing' } => {
      try {
        const profileId = scheduleProfileId
        const found = vault.list(profileId).find((secret) => TELEGRAM_SECRET.test(secret.name))
        if (!found) return { token: null, because: 'missing' }
        const full = vault.reveal(profileId, found.id)
        return full.value.trim() ? { token: full.value.trim() } : { token: null, because: 'missing' }
      } catch {
        // `list` and `reveal` both throw when the vault is locked, which is the only expected failure here.
        return { token: null, because: 'locked' }
      }
    }

    const scheduleProfile = async (): Promise<string> => (await profilesStore.active()).id
    let scheduleProfileId = await scheduleProfile()
    profilesStore.onChange(() => {
      void scheduleProfile().then((id) => {
        scheduleProfileId = id
      })
    })

    const controlNow = async (capability: string, params: Record<string, unknown>) => {
      const result = await browserControl!.control.execute(
        { capability, params, source: 'user' },
        { source: 'user', confirm: async () => true }
      )
      return result
    }

    const scheduleEngine = new TemporalEngine({
      store: schedules,
      activeProfile: () => scheduleProfileId,
      device: deviceNow,
      runners: makeRunners({
        /*
         * The same entry point, the same source, the same logging as anything else.
         *
         * Being on a schedule grants nothing: whatever is switched off in Settings is just as switched off at three
         * in the morning, and a locked tab is still a locked tab.
         */
        execute: async (capability, params) => {
          const result = await controlNow(capability, params)
          return {
            ok: result.ok,
            detail: result.ok ? (result.verification?.detail ?? 'Done.') : (result.error?.message ?? 'It did not work.')
          }
        },
        openTabs: async () => {
          const listed = await controlNow('tabs.list', {})
          const rows = Array.isArray(listed.data) ? (listed.data as Record<string, unknown>[]) : []
          return rows
            .filter((r) => typeof r.url === 'string')
            .map((r) => ({ tabId: Number(r.id ?? r.tabId ?? -1), url: String(r.url) }))
            .filter((r) => Number.isFinite(r.tabId) && r.tabId >= 0)
        },
        runWorkflow: async (idOrName) => {
          if (!workflowEngine) return { ok: false, detail: 'Orbis has no workflows at the moment.' }
          const all = (await workflowEngine.list()).filter((w) => w.status !== 'archived')
          // By id first, then by name, because a schedule made from a sentence only ever had a name to go on.
          const found =
            all.find((w) => w.id === idOrName) ?? all.find((w) => w.name.toLowerCase() === idOrName.toLowerCase())
          if (!found) return { ok: false, detail: 'There is no workflow called "' + idOrName + '" any more.' }
          const run = await workflowEngine.run(found.id, { trigger: 'schedule' })
          /*
           * Waited for, rather than reported as done the moment it starts.
           *
           * The engine records a summary when a run finishes, so this watches for this run's own summary. Without
           * that wait, a workflow that failed would be written down as a schedule that worked -- which is the one
           * thing the scheduler must never do.
           */
          const deadline = Date.now() + 15 * 60_000
          while (Date.now() < deadline) {
            const summary = (await workflowEngine.history(found.id)).find((r) => r.runId === run.runId)
            if (summary) {
              return {
                ok: summary.status === 'completed',
                detail: summary.error?.message ?? 'Ran "' + found.name + '", ' + summary.stepsRun + ' steps.'
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 2000))
          }
          return { ok: false, detail: '"' + found.name + '" was still running after fifteen minutes.' }
        },
        ask: async (prompt) => {
          const answer = await askOrion(
            { prompt, expects: 'value', context: {} },
            GROQ_API_KEYS,
            fetchForOrion,
            new AbortController().signal
          )
          return typeof answer.value === 'string' ? answer.value : JSON.stringify(answer.value ?? '')
        },
        workspace: async (idOrName) => {
          const all = await workspacesStore.list()
          const found =
            all.find((w) => w.id === idOrName) ?? all.find((w) => w.name.toLowerCase() === idOrName.toLowerCase())
          if (!found) return null
          return {
            tabs: found.tabs as unknown as Record<string, unknown>[],
            groups: (found.groups ?? []) as unknown as Record<string, unknown>[]
          }
        },
        webhook: (url, message) => postWebhook((address, init) => net.fetch(address, init), url, message),
        telegram: (chatId, message) =>
          sendTelegram({ token: telegramToken, fetch: (url, init) => net.fetch(url, init) }, chatId, message),
        openPage: async (pageId) => {
          if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, detail: 'The Orbis window is not open.' }
          /*
           * Resolved first, then handed to the window.
           *
           * Pages are hosted in the Orbis window, so opening one means asking the window -- but the Page is looked
           * up here so that a Page which no longer exists is a plain failure with a reason, rather than a message
           * sent into the window and reported as a success.
           */
          const resolved = await pages.open(scheduleProfileId, pageId)
          if (!resolved.found) return { ok: false, detail: 'There is no Page at "' + pageId + '" any more.' }
          sendToWindow('schedules:open-page', resolved.canonicalUrl)
          return { ok: true, detail: 'Opened "' + resolved.page.manifest.title + '".' }
        },
        notify: (title, body) => {
          void notifications?.publish({ type: 'schedule.completed', profileId: scheduleProfileId, fields: { name: title, summary: body } })
        }
      }),
      onChange: (job) => sendToWindow('schedules:changed', job),
      onNotice: (job, body) => {
        void notifications?.publish({ type: 'schedule.completed', profileId: scheduleProfileId, fields: { name: job.name, summary: body, scheduleId: job.jobId, runId: `${job.jobId}:${Date.now()}` } })
      }
    })
    registerTemporalIpc({
      store: schedules,
      engine: scheduleEngine,
      activeProfile: () => scheduleProfileId,
      device: deviceNow,
      getWindow: () => mainWindow,
      send: (channel, ...args) => sendToWindow(channel, ...args)
    })
    /**
     * What Orbis should do about being closed, and about a sleeping computer.
     *
     * Worked out after every change rather than once at startup, because both answers depend on what is actually
     * scheduled: deleting the last schedule should let Orbis quit and should stop the machine waking for nothing.
     */
    const showTray = (because: string): void => {
      if (stayingAlive) {
        stayingAlive.because = because
        stayingAlive.tray?.setToolTip(because)
        return
      }
      const icon = orbisIcon()
      const tray = icon ? new Tray(icon) : null
      tray?.setToolTip(because)
      tray?.setContextMenu(
        Menu.buildFromTemplate([
          { label: because, enabled: false },
          { type: 'separator' },
          { label: 'Open Orbis', click: () => void createWindow() },
          /*
           * Hibernate, offered here because this is the menu somebody sees when Orbis is running for a schedule.
           *
           * A hibernated computer can be woken for what is due; a switched-off one cannot, and no software can
           * change that. So this is the alternative to switching off, not a tidy-up.
           */
          {
            label: 'Hibernate (schedules can still wake it)',
            click: () => {
              void hibernateNow().then((result) => {
                /*
                 * A notification rather than a message to the window.
                 *
                 * This menu only exists when there is no window, so sending the failure there would be sending it
                 * nowhere -- and "I pressed hibernate and nothing happened" with no reason is the worst outcome.
                 */
                if (!result.ok) {
                  void notifications?.publish({ type: 'system.problem', fields: { title: 'Orbis could not hibernate', reason: result.detail } })
                }
              })
            }
          },
          { type: 'separator' },
          { label: 'Quit Orbis', click: () => app.quit() }
        ])
      )
      stayingAlive = { tray, because }
    }

    const hideTray = (): void => {
      stayingAlive?.tray?.destroy()
      stayingAlive = null
    }

    reconsiderStaying = async (): Promise<void> => {
      const settings = await store.getSettings()
      const jobs = await schedules.all(scheduleProfileId)
      const answer = shouldStayAlive(jobs, settings.keepSchedulesRunning)
      const noWindow = BrowserWindow.getAllWindows().length === 0

      if (!answer.stay) {
        // Was staying for a schedule that has since gone, with no window to go back to: there is nothing left to do.
        if (noWindow && stayingAlive) {
          hideTray()
          app.quit()
          return
        }
        hideTray()
      } else if (noWindow) showTray(answer.because)

      if (!wakeIsPossible()) return
      const at = settings.wakeForSchedules ? earliestWake(jobs, Date.now()) : null
      if (at === null) {
        // Removed rather than left behind, so a machine never keeps waking for an Orbis with nothing to do.
        await clearWake()
        return
      }
      /*
       * The wake starts Orbis, which is the only thing that can carry the schedule out.
       *
       * While developing that is the Electron binary with the project as its argument -- the same way this session
       * started -- so the task works before there is anything packaged.
       */
      const args = app.isPackaged ? ['--woken-for-schedule'] : [app.getAppPath(), '--woken-for-schedule']
      await applyWake(at, process.execPath, args)
    }

    // Anything that changes what is scheduled changes both answers, so they are worked out again.
    scheduleEngine.onChanged = () => void reconsiderStaying?.()
    schedulesForChat = { store: schedules, engine: scheduleEngine, profileId: () => scheduleProfileId }
    void reconsiderStaying()
    scheduleEngine.start()
    app.on('before-quit', () => scheduleEngine.stop())

    /** Orion Search sessions, saved per profile. Never read into or out of Orbis Chat. */
    const searchSessions = new SearchSessionStore(app.getPath('userData'), await stepProfile())
    searchSessionsForBrowser = searchSessions
    searchSessions.onChange(() => sendToWindow('search-sessions:changed'))
    profilesStore.onChange(() => {
      void stepProfile().then((id) => searchSessions.useProfile(id))
    })
    app.on('before-quit', () => searchSessions.close())
    const searchCall = <T,>(run: (...args: unknown[]) => T) => (event: IpcMainInvokeEvent, ...args: unknown[]): T => {
      if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
      return run(...args)
    }
    ipcMain.handle('search-sessions:save', searchCall((session) => searchSessions.save(session)))
    ipcMain.handle('search-sessions:list', searchCall((query) => searchSessions.list(typeof query === 'string' ? query.slice(0, 200) : undefined)))
    ipcMain.handle('search-sessions:get', searchCall((id) => searchSessions.get(String(id))))
    ipcMain.handle('search-sessions:find', searchCall((about) => searchSessions.find(String(about).slice(0, 200))))
    ipcMain.handle('search-sessions:remove', searchCall((id) => searchSessions.remove(String(id))))
    ipcMain.handle('search-sessions:clear', searchCall(() => searchSessions.clear()))

    ipcMain.handle('memory:list', memoryCall((store, options) => {
      const o = (options ?? {}) as Record<string, unknown>
      return store.list({ query: typeof o.query === 'string' ? o.query.slice(0, 200) : undefined, includeArchived: o.includeArchived === true, category: category(o.category) })
    }))
    ipcMain.handle('memory:add', memoryCall((store, text, options) => {
      const o = (options ?? {}) as Record<string, unknown>
      return store.add(text, { category: category(o.category), pinned: o.pinned === true, origin: 'settings' })
    }))
    ipcMain.handle('memory:update', memoryCall((store, id, patch) => {
      const p = (patch ?? {}) as Record<string, unknown>
      return store.update(String(id), {
        ...(p.text !== undefined ? { text: p.text } : {}),
        ...(category(p.category) ? { category: category(p.category) } : {}),
        ...(typeof p.pinned === 'boolean' ? { pinned: p.pinned } : {}),
        ...(typeof p.archived === 'boolean' ? { archived: p.archived } : {})
      })
    }))
    ipcMain.handle('memory:remove', memoryCall((store, id) => store.remove(String(id))))
    ipcMain.handle('memory:clear', memoryCall((store) => store.clear()))
    ipcMain.handle('memory:settings', memoryCall((store) => store.settings()))
    ipcMain.handle('memory:set-settings', memoryCall((store, next) => {
      const n = (next ?? {}) as Record<string, unknown>
      return store.setSettings({ ...(typeof n.enabled === 'boolean' ? { enabled: n.enabled } : {}), ...(typeof n.useInChat === 'boolean' ? { useInChat: n.useInChat } : {}) })
    }))

    ipcMain.handle('skills:settings', (event) => (fromWindow(event), skills.settings()))
    ipcMain.handle('skills:set-settings', (event, next: unknown) => {
      fromWindow(event)
      const v = (next ?? {}) as Record<string, unknown>
      return skills.setSettings({
        ...(typeof v.enabled === 'boolean' ? { enabled: v.enabled } : {}),
        ...(typeof v.learnFromRuns === 'boolean' ? { learnFromRuns: v.learnFromRuns } : {}),
        ...(v.reuse === 'never' || v.reuse === 'suggest' || v.reuse === 'auto' ? { reuse: v.reuse } : {})
      })
    })
    ipcMain.handle('skills:list', (event) => (fromWindow(event), skills.list()))
    ipcMain.handle('skills:preview', async (event, runId: unknown) => {
      fromWindow(event)
      const settings = await skills.settings()
      const run = await ownRun(runId)
      const { candidate, why } = skills.preview(run.state)
      return {
        offer: settings.learnFromRuns && Boolean(candidate),
        timesDone: await skills.timesDone(run.state.goal),
        why,
        candidate: candidate && {
          name: candidate.workflow.name,
          whenToUse: candidate.meta.whenToUse,
          category: candidate.meta.category,
          domains: candidate.meta.domains,
          steps: candidate.workflow.steps.map((step) => ({ name: step.name, byYou: step.type === 'userAction' })),
          inputs: candidate.workflow.inputs.map((input) => ({ label: input.label || input.name, asked: input.default === undefined })),
          permissions: candidate.workflow.settings.permissions,
          notes: candidate.notes
        }
      }
    })
    ipcMain.handle('skills:save', async (event, runId: unknown, changes: unknown) => {
      fromWindow(event)
      return skills.saveFromRun((await ownRun(runId)).state, edits(changes))
    })
    ipcMain.handle('skills:match', (event, request: unknown) => {
      fromWindow(event)
      // The page the person is really on, read here rather than taken from the window.
      const url = activePage()?.getURL()
      return skills.match(text(request, 2000), url)
    })
    ipcMain.handle('skills:run', (event, workflowId: unknown, inputs: unknown, request: unknown) => {
      fromWindow(event)
      const values = inputs && typeof inputs === 'object' ? Object.fromEntries(Object.entries(inputs as Record<string, unknown>).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, (v as string).slice(0, 2000)])) : {}
      return skills.run(text(workflowId, 80), values, text(request, 200) || undefined)
    })
    ipcMain.handle('skills:edit', (event, workflowId: unknown, changes: unknown) => (fromWindow(event), skills.edit(text(workflowId, 80), edits(changes))))
    ipcMain.handle('skills:set-enabled', (event, workflowId: unknown, on: unknown) => (fromWindow(event), skills.setEnabled(text(workflowId, 80), on === true)))
    ipcMain.handle('skills:remove', (event, workflowId: unknown, alsoWorkflow: unknown) => (fromWindow(event), skills.remove(text(workflowId, 80), alsoWorkflow === true)))
    ipcMain.handle('skills:remove-all', (event) => (fromWindow(event), skills.removeAll()))
    ipcMain.handle('skills:roll-back', (event, workflowId: unknown) => (fromWindow(event), skills.rollBack(text(workflowId, 80))))
    ipcMain.handle('skills:export', (event, workflowId: unknown) => (fromWindow(event), skills.exportSkill(text(workflowId, 80))))
    ipcMain.handle('skills:import', (event, json: unknown) => (fromWindow(event), skills.importSkill(text(json, 2_000_000))))

    /**
     * Galaxy: the profile's own things and how they are really connected, built from the stores above whenever it is
     * looked at after a change. It keeps no copy of any of them; only links the person makes are stored.
     */
    const callsIn = (steps: WorkflowStep[]): string[] =>
      steps.flatMap((step) =>
        step.type === 'call' ? [step.workflowId] : step.type === 'if' ? [...callsIn(step.then), ...(step.elseIf ?? []).flatMap((b) => callsIn(b.steps)), ...callsIn(step.else ?? [])] : step.type === 'repeat' ? callsIn(step.steps) : []
      )
    const galaxy = new GalaxyService({
      userData: app.getPath('userData'),
      profileId: await stepProfile(),
      collect: async () => {
        const [notes, tasks, skillViews, flows, spaces, boards, made] = await Promise.all([
          notesStore.all(),
          tasksStore.snapshot(),
          skills.list(),
          workflows.list(),
          workspacesStore.list(),
          whiteboardStore.list(),
          artifactStore.list((await profilesStore.active()).id)
        ])
        return {
          memories: memory ? memory.list().map((m) => ({ id: m.id, text: m.text, category: m.category, createdAt: m.createdAt, updatedAt: m.updatedAt, archived: m.archived })) : [],
          searches: searchSessions.withSources().map((s) => ({ id: s.id, title: s.title, turns: s.turns, startedAt: s.startedAt, updatedAt: s.updatedAt, sources: s.sourceList })),
          notes: notes.map((n) => ({ id: n.id, title: n.title, archived: n.archived, createdAt: n.createdAt, updatedAt: n.updatedAt, ...(n.source ? { source: { url: n.source.url, title: n.source.title } } : {}) })),
          tasks: tasks.tasks.map((t) => ({ id: t.id, title: t.title, done: t.done, createdAt: t.createdAt, updatedAt: t.updatedAt, ...(t.link ? { link: { url: t.link.url, title: t.link.title } } : {}) })),
          skills: skillViews.map((s) => ({ workflowId: s.workflow.id, name: s.workflow.name, domains: s.meta.domains, enabled: s.meta.enabled, createdAt: s.meta.createdAt, updatedAt: s.meta.updatedAt })),
          workflows: flows.map((w) => ({ id: w.id, name: w.name, createdAt: w.createdAt, updatedAt: w.updatedAt, calls: callsIn(w.steps), archived: w.status === 'archived' })),
          workspaces: spaces.map((w) => ({ id: w.id, name: w.name, createdAt: w.createdAt, updatedAt: w.updatedAt, tabs: w.tabs.map((t) => ({ url: t.url, title: t.title })), ...(w.project ? { project: w.project } : {}) })),
          whiteboards: boards.map((b) => ({ id: b.id, name: b.name, createdAt: b.createdAt, updatedAt: b.updatedAt })),
          bookmarks: (browserLibrary!?.snapshot().bookmarks ?? []).map((b) => ({ url: b.url, title: b.title, addedAt: b.addedAt })),
          artifacts: made.map((a) => ({ id: a.artifactId, title: a.title, kind: a.kind, version: a.version, createdAt: a.createdAt, updatedAt: a.updatedAt, derivedFrom: a.derivedFrom?.artifactId ?? null }))
        }
      }
    })
    galaxy.onChange(() => sendToWindow('galaxy:changed'))
    galaxyForChat = galaxy
    // The Chromium side panel keeps a Galaxy selection through the same stores the window does.
    Object.assign(galaxy, { notes: notesStore, whiteboard: whiteboardStore, workspaces: workspacesStore })
    workspacesForChat = workspacesStore
    for (const source of [memory, searchSessions, notesStore, tasksStore, workspacesStore, whiteboardStore]) source?.onChange(() => galaxy.invalidate())
    browserLibrary!?.addListener(() => galaxy.invalidate())
    profilesStore.onChange(() => {
      void stepProfile().then((id) => galaxy.useProfile(id))
    })
    app.on('before-quit', () => galaxy.close())
    const TYPES: GalaxyNodeType[] = ['project', 'memory', 'search', 'page', 'site', 'note', 'task', 'skill', 'workflow', 'workspace', 'whiteboard', 'bookmark']
    ipcMain.handle('galaxy:view', async (event, raw: unknown) => {
      fromWindow(event)
      // Skills and workflows announce changes to the window rather than to Galaxy, so the map is rebuilt when opened.
      galaxy.refresh()
      const v = (raw ?? {}) as Record<string, unknown>
      const view: GalaxyView = {
        ...(Array.isArray(v.types) ? { types: v.types.filter((t): t is GalaxyNodeType => TYPES.includes(t as GalaxyNodeType)) } : {}),
        ...(typeof v.query === 'string' ? { query: v.query.slice(0, 200) } : {}),
        ...(typeof v.focus === 'string' ? { focus: v.focus.slice(0, 2100) } : {}),
        ...(typeof v.depth === 'number' ? { depth: v.depth } : {}),
        ...(typeof v.from === 'number' ? { from: v.from } : {}),
        ...(typeof v.to === 'number' ? { to: v.to } : {}),
        limit: typeof v.limit === 'number' ? Math.max(10, Math.min(1500, v.limit)) : 400
      }
      return galaxy.view(view)
    })
    ipcMain.handle('galaxy:describe', (event, id: unknown) => (fromWindow(event), galaxy.describe(text(id, 2100))))
    ipcMain.handle('galaxy:link', (event, from: unknown, to: unknown, note: unknown) => (fromWindow(event), galaxy.link(text(from, 2100), text(to, 2100), text(note, 200) || undefined)))
    ipcMain.handle('galaxy:unlink', (event, id: unknown) => (fromWindow(event), galaxy.unlink(text(id, 80))))
    ipcMain.handle('galaxy:ask', (event, ids: unknown, question: unknown) => {
      fromWindow(event)
      return galaxy.askAbout(Array.isArray(ids) ? ids.filter((i): i is string => typeof i === 'string') : [], text(question, 1000))
    })

    app.on('before-quit', () => {
      for (const run of stepRuns.values()) run.stopRun('Orbis is closing.')
      stepRuns.clear()
    })
    profilesStore.onChange(() => {
      for (const run of stepRuns.values()) run.stopRun('The profile changed.')
      stepRuns.clear()
    })

    /**
     * Weather and news for the new tab's widgets, fetched and cached here so a page never talks to those services itself.
     * No keys: MET Norway and OpenStreetMap ask only to be identified, cached against and credited, and they are.
     */
    const widgetFeeds = new WidgetFeeds({ fetch: (url, init) => net.fetch(url, init), appVersion: app.getVersion(), contact: process.env.ORBIS_WEATHER_CONTACT })
    ipcMain.handle('widgets:weather', (event, city: unknown) => {
      if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
      return widgetFeeds.weather(typeof city === 'string' ? city : '')
    })
    ipcMain.handle('widgets:feed', (event, url: unknown) => {
      if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
      return widgetFeeds.feed(typeof url === 'string' ? url.slice(0, 2000) : '')
    })

    const browserSidebar = new BrowserSidebarStore(app.getPath('userData'))
    browserSidebarForBrowser = browserSidebar
    const sidebarProfile = async (): Promise<string> => (await profilesStore.active()).id
    ipcMain.handle('browser-sidebar:get', async (event) => {
      if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
      return browserSidebar.read(await sidebarProfile())
    })
    ipcMain.handle('browser-sidebar:save', async (event, layout: unknown) => {
      if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
      return browserSidebar.write(await sidebarProfile(), layout)
    })
    ipcMain.handle('browser-sidebar:reset', async (event) => {
      if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')
      return browserSidebar.reset(await sidebarProfile())
    })
    // Switching profile brings that profile's arrangement with it.
    profilesStore.onChange(() => void sidebarProfile().then(async (id) => sendToWindow('browser-sidebar:changed', await browserSidebar.read(id))).catch(() => undefined))
    // A workspace that keeps itself up to date follows the window while it is the one that is open.
    browserControl.windowControl.onState((state) => workspacesStore.onBrowserState(state ? { tabs: state.tabs, groups: state.groups } : null))
    const clipboardHistory = new ClipboardHistory({
      clipboard: platform().clipboard,
      imageSize,
      userData: app.getPath('userData'),
      // Only watched while Orbis itself is in front, so copying elsewhere costs nothing.
      isActive: () => Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()),
      context: () => {
        const tab = browserControl?.windowControl.state?.tabs.find((t) => t.active)
        return tab ? { private: tab.private, url: tab.url, title: tab.title } : {}
      }
    })
    registerPersonalIpc({
      notes: notesStore,
      tasks: tasksStore,
      profiles: profilesStore,
      switchProfile,
      clipboard: clipboardHistory,
      whiteboard: whiteboardStore,
      workspaces: workspacesStore,
      control: browserControl.control,
      getWindow: () => mainWindow,
      send: sendToWindow,
      readPage: async () => {
        const result = await browserControl!.control.execute({ capability: 'page.read', params: { maxChars: 2000 }, target: {}, source: 'user' }, { confirm: async () => true })


    /**
     * What the widgets on the browser's start page are shown, and what pressing something on one does.
     *
     * Every reader here is one of Orbis's own stores, for the profile in use -- no second copy of anything. And
     * nothing a widget could be handed by mistake: there is deliberately no reader for the vault, for cookies, for
     * passwords or for another profile, so there is nothing to hand over.
     */
    const widgetData = createWidgetData({
      tasks: () => tasksStore.allTasks(),
      completeTask: async (id) => {
        try {
          await tasksStore.complete(id, true)
          return true
        } catch {
          return false
        }
      },
      notes: () => notesStore.all(),
      createNote: async () => {
        try {
          return (await notesStore.create()).id
        } catch {
          return null
        }
      },
      clips: () => clipboardHistory.all(),
      copyClip: async (id) => {
        try {
          await clipboardHistory.copyToClipboard(id)
          return true
        } catch {
          return false
        }
      },
      workspaces: () => workspacesStore.list(),
      currentWorkspace: () => workspacesStore.current(),
      openWorkspace: async (id) => {
        const done = await browserControl!.control
          .execute({ capability: 'workspaces.open', params: { workspace: id } }, { source: 'user', confirm: async () => true })
          .catch(() => null)
        return done?.ok === true
      },
      boards: () => whiteboardStore.list(),
      bookmarks: async () => browserLibrary?.snapshot().bookmarks ?? [],
      downloads: async () =>
        (browserLibrary?.snapshot().downloads ?? []).map((one) => ({
          id: one.id,
          name: one.filename,
          state: one.state,
          received: one.receivedBytes,
          total: one.totalBytes,
          at: one.finishedAt ?? one.startedAt
        })),
      showDownload: async (id) => {
        const found = browserLibrary?.snapshot().downloads.find((one) => one.id === id)
        if (!found?.path) return false
        shell.showItemInFolder(found.path)
        return true
      },
      history: async () => browserLibrary?.snapshot().history ?? [],
      tabs: async () => {
        const read = (await browserControl!.control.snapshot(['browser']).catch(() => null)) as { browser?: unknown } | null
        const browser = (read?.browser ?? null) as { tabs?: { id?: number; title?: string; url?: string; active?: boolean; groupId?: number }[] } | null
        const tabs = Array.isArray(browser?.tabs) ? browser.tabs : []
        return {
          count: tabs.length,
          groups: new Set(tabs.map((one) => one.groupId).filter((group): group is number => typeof group === 'number' && group >= 0)).size,
          items: tabs.map((one) => ({ id: Number(one.id ?? 0), title: String(one.title ?? ''), url: String(one.url ?? ''), active: one.active === true }))
        }
      },
      weather: async (city) => {
        const got = await widgetFeeds.weather(city)
        return got.ok ? { ok: true as const, data: got.data, fetchedAt: got.fetchedAt, stale: got.stale } : { ok: false as const, reason: got.reason }
      },
      newsFeed: async (url) => {
        const got = await widgetFeeds.feed(url)
        return got.ok ? { ok: true as const, data: got.data, fetchedAt: got.fetchedAt, stale: got.stale } : { ok: false as const, reason: got.reason }
      },
      /**
       * One price, from the instruments this profile already follows in Markets.
       *
       * Deliberately not a lookup of its own: Markets decides what Orbis follows and from where, and a widget asking
       * for a symbol nobody follows is told so -- which is the truth, and is something the person can act on.
       */
      marketQuote: async (symbol) => {
        const strip = await markets.tickerState().catch(() => null)
        const found = strip?.items.find((one) => one.instrument.symbol.toUpperCase() === symbol.toUpperCase())
        if (!found?.quote || found.quote.last === null) return null
        return {
          symbol: found.instrument.symbol.toUpperCase(),
          name: found.instrument.name || found.instrument.symbol.toUpperCase(),
          price: found.quote.last,
          change: found.quote.changePercent ?? 0,
          currency: found.instrument.currency || '',
          // Markets keeps no intraday series for the strip, so the card draws no line rather than a made-up one.
          points: [],
          asOf: found.quote.timestamp
        }
      },
      online: () => net.isOnline(),
      openPanel: async (view) => {
        const done = await browserControl!.control
          .execute({ capability: 'surface.open', params: { name: 'orbis-panel', at: `#${view}` } }, { source: 'user', confirm: async () => true })
          .catch(() => null)
        return done?.ok === true
      },
      askOrion: async (text) => {
        // Handed to the chat, and the window brought forward with it, which is what "ask Orion" means from a page.
        if (!mainWindow || mainWindow.isDestroyed()) return false
        mainWindow.webContents.send('chat:ask', text)
        mainWindow.show()
        return true
      },
      onStoreChange: (listen) => {
        const stops = [
          notesStore.onChange(() => listen('notes')),
          tasksStore.onChange(() => {
            listen('tasks')
            listen('reminders')
          }),
          clipboardHistory.onChange(() => listen('clipboard')),
          workspacesStore.onChange(() => listen('workspaces')),
          whiteboardStore.onChange(() => listen('whiteboard')),
          browserLibrary?.addListener(() => {
            listen('bookmarks')
            listen('downloads')
            listen('recent')
          })
        ].filter((stop): stop is () => void => typeof stop === 'function')
        return () => stops.forEach((stop) => stop())
      }
    })
    widgetsForBrowser = { runtime: widgetRuntime, data: widgetData }
        const data = (result.data ?? {}) as { url?: string; title?: string; selection?: string }
        if (!result.ok || !data.url) throw new Error('There is no page open to save.')
        return { url: data.url, title: data.title ?? '', ...(data.selection ? { selection: data.selection } : {}) }
      },
      browserState: () => {
        const state = browserControl?.windowControl.state
        return state ? { tabs: state.tabs, groups: state.groups } : null
      },
      pageImage: async () => {
        const page = await browserControl!.control.execute({ capability: 'page.read', params: { maxChars: 1 }, target: {}, source: 'user' }, { confirm: async () => true })
        const shot = await browserControl!.control.execute({ capability: 'page.screenshot', params: { maxWidth: 1280 }, target: {}, source: 'user' }, { confirm: async () => true })
        const image = (shot.data ?? {}) as { dataUrl?: string; width?: number; height?: number }
        const about = (page.data ?? {}) as { url?: string; title?: string }
        if (!shot.ok || !image.dataUrl) throw new Error(shot.error?.message ?? 'The page could not be captured.')
        return { dataUrl: image.dataUrl, width: image.width ?? 0, height: image.height ?? 0, url: about.url ?? '', title: about.title ?? '' }
      }
    })
    panelStoresForBrowser = {
      library: browserLibrary ?? undefined,
      removeFile: (path) => fs.rm(path, { force: true }),
      openFile: (path) => shell.openPath(path),
      clipboard: clipboardHistory,
      tasks: tasksStore,
      whiteboard: whiteboardStore,
      workspaces: workspacesStore,
      research: { withSources: (limit) => searchSessionsForBrowser?.withSources(limit) ?? [] },
      control: browserControl.control as unknown as PanelStores['control']
    }
    void clipboardHistory.start().catch((err: unknown) => console.error('[clipboard] failed to start', err))
    app.on('before-quit', () => {
      clipboardHistory.stop()
      workspacesStore.stop()
      void profilesStore.flush()
      void Promise.all([notesStore.flush(), tasksStore.flush(), clipboardHistory.flush(), whiteboardStore.flush(), workspacesStore.flush(), browserSidebar.flush()])
    })

    app.on('before-quit', () => void browserLibrary?.flush())
    // Closing to make way for the installer still saves everything first; it is a restart, not a loss.
    app.on('before-quit', () => {
      updates?.stop()
      if (updatesQuitting) void updates?.getStatus()
    })
    /**
     * Whether this launch is the browser's, decided before the window is made.
     *
     * Embedded, the browser has no window of its own to open into, so the chat still has to appear -- the setting is
     * answered in the renderer there, exactly as before.
     */
    startInBrowser = !embeddedBrowser && (await store.getSettings()).openBrowserOnLaunch === true

    mainWindow = createWindow()
    mainWindow.on('closed', () => (mainWindow = null))

    if (startInBrowser) {
      /**
       * Straight into the browser.
       *
       * The chat window exists and is hidden rather than not made at all: everything in Orbis expects it to be there,
       * and returning to the chat is then one press rather than a cold start.
       */
      void chromiumBrowser?.open('', { newTab: false }).catch(() => undefined)
    }
    // Tab Lock's focus and minimise triggers hang off this window, and it did not exist when Tab Lock was set up.
    tabLock.attachWindow()
    profileLock.attachWindow()
  })

  app.on('window-all-closed', () => {
    for (const controller of activeRequests.values()) controller.abort()
    /**
     * Closing the window usually means quitting, and sometimes means only closing the window.
     *
     * `reconsiderStaying` decides, and it decides from what is actually scheduled -- so Orbis stays only when
     * somebody asked it to and there is something for it to stay for, and puts a tray icon up when it does.
     */
    if (!reconsiderStaying) {
      app.quit()
      return
    }
    void reconsiderStaying().then(() => {
      if (!stayingAlive) app.quit()
    })
  })
}
