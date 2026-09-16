import { app, BrowserWindow, clipboard, components, dialog, ipcMain, Menu, nativeTheme, net, session, shell, webContents } from 'electron'
import type { MenuItemConstructorOptions, OpenDialogOptions, TitleBarOverlayOptions, WebContents } from 'electron'
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
  AdBlockSettings,
  PickedFiles,
  Research,
  SettingsUpdate,
  StreamEvent
} from '../shared/types'
import { IMAGE_GEN_STATUS } from '../shared/types'
import { streamChat, testApiKey } from './nim'
import { buildSystemPrompt } from './prompt'
import { UpdateManager } from './update/manager'
import { electronPlatform, imageSize } from './platformElectron'
import { asPageHandle } from './pageHandle'
import { runSearch } from './search'
import type { Platform } from './platform'
import { answerContext, runResearch } from './research'
import { OrbisAdBlock } from './adblock/electron'
import { BrowserIntegration } from './browserIntegration'
import { BrowserLibrary } from './browserLibrary'
import { findSource, latestResearch, sourceNotes } from '../shared/research'
import { detectImageGenRequest, generateImage, rewriteImagePrompt } from './imagegen'
import { classifyAutomationMessage, classifyIntent } from './intent'
import type { ChatIntent } from './intent'
import { automationProgress } from '../shared/automation'
import { runBrowserAgent } from './browserAgent'
import { transcribeAudio } from './voice'
import { completeDraft, generateTitle, predictQueries, suggestFollowups } from './suggest'
import { parseWebSuggestions } from '../shared/omnibox'
import { AuthManager } from './auth'
import { configuredProvider, protectedSessionFile } from './authSecrets'
import { fetchFavicon } from './favicon'
import { ExtensionsManager } from './extensions/manager'
import type { ReportedTab, WindowRequest } from './extensions/bridge'
import { setupBrowserControl } from './browserControl/setup'
import { WorkflowStore } from './workflows/store'
import { WorkflowRecorder } from './workflows/recorder'
import { WorkflowEngine } from './workflows/engine'
import { registerWorkflowIpc } from './workflows/ipc'
import { askOrion, draftWorkflow } from './workflows/orion'
import { NotesStore } from './personal/notes'
import { TasksStore } from './personal/tasks'
import { ClipboardHistory } from './personal/clipboard'
import { WhiteboardStore } from './personal/whiteboard'
import { WorkspacesStore } from './personal/workspaces'
import { ProfilesStore } from './personal/profiles'
import { ExperienceStore } from './experience/store'
import { registerExperienceIpc } from './experience/ipc'
import type { Profile } from '../shared/profiles'
import { registerPersonalIpc } from './personal/ipc'
import { Store } from './store'

// Baked in at build time from GROQ_API_KEY in .env.local (see electron.vite.config.ts).
declare const __GROQ_API_KEYS__: string[]
const GROQ_API_KEYS: string[] = typeof __GROQ_API_KEYS__ === 'undefined' ? [] : __GROQ_API_KEYS__

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

/** The visible text of the Orbis browser tab showing `url`, for questions about the open page. */
async function readOpenPage(url: string): Promise<string | null> {
  const tab = webContents.getAllWebContents().find((wc) => !wc.isDestroyed() && wc.getType() === 'webview' && wc.getURL() === url)
  if (!tab) return null
  try {
    const text = await Promise.race([
      tab.executeJavaScript('document.body ? document.body.innerText : ""') as Promise<unknown>,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), 4000))
    ])
    return String(text).replace(/\n{3,}/g, '\n\n').trim().slice(0, 7000) || null
  } catch {
    return null
  }
}

/** The conversation's most recent browser automation, which "continue" and "keep going" refer to. */
function latestAutomation(messages: ChatMessage[]): AutomationState | undefined {
  return [...messages].reverse().find((m) => m.role === 'assistant' && m.automation)?.automation
}

/** Ad blocking for the in-app browser session; set up when the app is ready. */
let adblock: OrbisAdBlock | null = null
/** Browser shortcuts, context menu, history, bookmarks, downloads and permissions; set up when the app is ready. */
let browser: BrowserIntegration | null = null
let browserLibrary: BrowserLibrary | null = null
/** The Orbis Browser Control Layer: every browser capability, for the window, Orion and automations. */
let browserControl: ReturnType<typeof setupBrowserControl> | null = null
/** Pop-out browser windows that are open. */
const popouts = new Set<BrowserWindow>()
/** Records workflows from what the user does (only while recording). */
let workflowRecorder: WorkflowRecorder | null = null

/** Instructions the user adds to a running automation, per chat request. */
const automationInstructions = new Map<string, string[]>()

/** Chat requests waiting for the window to report which browser tab Orbis should control. */
const browserTargets = new Map<string, (webContentsId: number | null) => void>()
/** Browser actions waiting for the user's approval, keyed by request and confirmation. */
const browserConfirmations = new Map<string, (approved: boolean) => void>()

/** Asks the window to open its browser and hand over the active tab. Only a browser tab inside that same window is accepted. */
function requestBrowserTarget(requestId: string, sender: WebContents, emit: (event: StreamEvent) => void, signal: AbortSignal): Promise<WebContents> {
  return new Promise((resolve, reject) => {
    const finish = (result: WebContents | Error): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      browserTargets.delete(requestId)
      if (result instanceof Error) reject(result)
      else resolve(result)
    }
    const onAbort = (): void => finish(new Error('Stopped.'))
    const timer = setTimeout(() => finish(new Error("The browser didn't open in time. Try again.")), 20_000)
    signal.addEventListener('abort', onAbort)
    browserTargets.set(requestId, (id) => {
      const target = id === null ? undefined : webContents.fromId(id)
      if (!target || target.isDestroyed() || target.getType() !== 'webview' || target.hostWebContents !== sender) {
        return finish(new Error("Orbis couldn't find the browser tab. Open the browser and try again."))
      }
      finish(target)
    })
    emit({ type: 'browser-target' })
  })
}

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
  const picked: PickedFiles = { attachments: [], skipped: [] }
  for (const path of paths.slice(0, 10)) {
    const name = basename(path)
    try {
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

function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/** A separate Orbis browser window for a page: same session, so sign-ins carry over; no preload or Node access. */
function popOutBrowser(url: string): BrowserWindow | null {
  if (typeof url !== 'string' || !isHttpUrl(url)) return null
  const popout = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'Orbis Browser',
    autoHideMenuBar: true,
    backgroundColor: '#111215',
    webPreferences: { partition: 'persist:browser', contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  popout.setMenuBarVisibility(false)
  popout.webContents.setWindowOpenHandler(({ url: next }) => {
    if (isHttpUrl(next)) void popout.webContents.loadURL(next)
    return { action: 'deny' }
  })
  void popout.loadURL(url)
  popouts.add(popout)
  popout.once('closed', () => popouts.delete(popout))
  return popout
}

/** Clears browsing data: cookies, storage and cache, history, address-bar searches and site permissions (bookmarks and downloads stay). */
async function clearBrowsingData(): Promise<void> {
  const browserSession = session.fromPartition('persist:browser')
  await Promise.all([browserSession.clearStorageData(), browserSession.clearCache()])
  browserLibrary?.clearHistory()
  browserLibrary?.clearSearches()
  browserLibrary?.forgetPermissions()
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 720,
    minHeight: 500,
    title: 'Orbis',
    // Packaged builds take their icon from the executable.
    ...(app.isPackaged ? {} : { icon: join(app.getAppPath(), 'build', 'icon.png') }),
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
      webviewTag: true
    }
  })

  win.once('ready-to-show', () => win.show())
  // The window's real fullscreen state, however it changes (F11, Esc, the OS).
  win.on('enter-full-screen', () => win.webContents.send('window:fullscreen-changed', true))
  win.on('leave-full-screen', () => win.webContents.send('window:fullscreen-changed', false))

  // The in-app browser gets no preload or Node access, and only loads web URLs.
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    // Only the browser's own sessions: the saved one, each profile's own, and the in-memory one private tabs share.
    const ownSession = params.partition === 'persist:browser' || params.partition === 'orbis-private' || /^persist:profile-[A-Za-z0-9_-]{1,80}$/.test(params.partition ?? '')
    if (!ownSession) event.preventDefault()
    // Web pages, "view page source" of a web page, and pages of installed extensions (their options pages and popups).
    const extensionPage = params.partition === 'persist:browser' && /^chrome-extension:\/\/[a-p]{32}\//.test(params.src)
    if (!isHttpUrl(params.src) && !/^view-source:https?:\/\//i.test(params.src) && !extensionPage) event.preventDefault()
  })
  browser?.attachWindow(win)
  // Links that would open a new window open as a tab in the in-app browser instead (Ctrl/middle-click in the background,
  // Shift+click in a new window); ad popups and ad redirects are stopped by ad blocking.
  win.webContents.on('did-attach-webview', (_event, contents) => {
    browser?.attachGuest(contents)
    browserControl?.trackGuest(contents)
    workflowRecorder?.attach(contents)
    const openTab = (url: string, details: { disposition: string; features: string }): void => {
      if (!isHttpUrl(url) || win.webContents.isDestroyed()) return
      if (browser) browser.openFromPage(url, details)
      else win.webContents.send('browser:new-tab', url, { background: false })
    }
    if (adblock) return adblock.attachWebview(contents, openTab)
    contents.setWindowOpenHandler(({ url, disposition, features }) => {
      openTab(url, { disposition, features })
      return { action: 'deny' }
    })
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
  ipcMain.handle('settings:get', () => store.getSettings())

  ipcMain.handle('settings:update', async (_event, update: SettingsUpdate) => {
    const settings = await store.updateSettings(update)
    nativeTheme.themeSource = settings.theme
    return settings
  })

  ipcMain.handle('settings:testKey', () => testApiKey(GROQ_API_KEYS, (url, init) => net.fetch(url, init)))

  ipcMain.handle('conversations:list', () => store.listConversations())
  ipcMain.handle('conversations:save', (_event, conversation: Conversation) => store.saveConversation(conversation))
  ipcMain.handle('conversations:delete', (_event, id: string) => store.deleteConversation(id))

  ipcMain.handle('chat:send', async (event, request: ChatRequest) => {
    const sender = event.sender
    const emit = (streamEvent: StreamEvent): void => {
      if (!sender.isDestroyed()) sender.send('chat:event', request.requestId, streamEvent)
    }
    const settings = await store.getSettings()

    const controller = new AbortController()
    activeRequests.set(request.requestId, controller)
    try {
      const systemPrompt = buildSystemPrompt(settings)
      let messages = request.messages
      const last = messages.at(-1)

      /** A text reply that needs web research or the open page first. */
      let plan: Extract<ChatIntent, { kind: 'answer' }> | null = null
      /** A question or command about ad blocking. */
      let blocking: Extract<ChatIntent, { kind: 'adblock' }> | null = null
      // Picture requests go to the image generator and browser tasks to the browser agent, however they're worded.
      if (last?.role === 'user' && request.images !== false) {
        // Recognising pictures and browser tasks is an extra: if it fails, the message still gets a normal reply.
        const detected = await detectIntent(messages, request.browser).catch((err: unknown): ChatIntent | null => {
          console.error('[chat] intent detection failed', err)
          const phrase = detectImageGenRequest(last.content)
          return phrase ? { kind: 'image', prompt: phrase } : null
        })
        // The browser's floating assistant only takes browser tasks; the classifier still decides once, loop or game.
        const intent: ChatIntent | null = request.ask
          ? detected?.kind === 'browse' || detected?.kind === 'image'
            ? null
            : detected
          : last.browserTask && detected?.kind !== 'browse' && detected?.kind !== 'adblock'
            ? { kind: 'browse', task: last.content, mode: 'once', resume: false }
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
              getTarget: async () => asPageHandle(await requestBrowserTarget(request.requestId, sender, emit, controller.signal)),
              findPage: (id) => {
                const found = webContents.fromId(id)
                return found && !found.isDestroyed() ? asPageHandle(found) : null
              },
              control: browserControl?.control,
              windowControl: browserControl?.windowControl,
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
            const image = await generateImage(intent.prompt, (url, init) => net.fetch(url, init), intent.seed)
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
        const facts = adblock
          ? await adblock.command(blocking.action, blocking.target, request.browser?.url)
          : "Ad blocking hasn't started yet, so there is no blocking information. Say so; don't guess."
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
        const shown = request.browser ? findSource(previous, request.browser.url) : undefined
        const includePage = Boolean(request.browser && (plan?.usePage || shown))
        const earlier = shown?.research ?? (includePage || research ? latestResearch(previous) : latestResearch(previous, 4))
        const pageText = includePage && request.browser ? await readOpenPage(request.browser.url) : null
        const context = answerContext({ research, earlier, browser: request.browser, onScreen: shown?.source.n, pageText, includePage })
        // Answers that draw only on earlier research can still cite it, so its sources come along (marked as earlier research).
        if (!research?.sources.length && earlier && (includePage || plan)) emit({ type: 'research', research: { ...earlier, reused: true } })
        // Kept inside the user message so the sources sit right next to the question they answer.
        if (context) messages = [...previous, { ...last, content: `${context}\n\nQuestion: ${last.content}` }]
      }
      await streamChat({
        apiKeys: GROQ_API_KEYS,
        model: request.model,
        messages,
        systemPrompt,
        reasoningEffort: request.reasoningEffort ?? settings.reasoningEffort,
        autoFallback: settings.autoFallback,
        signal: controller.signal,
        emit,
        fetchFn: (url, init) => net.fetch(url, init)
      })
    } finally {
      activeRequests.delete(request.requestId)
    }
  })

  ipcMain.handle('chat:abort', (_event, requestId: string) => {
    activeRequests.get(requestId)?.abort()
  })

  ipcMain.handle('chat:browser-target', (_event, requestId: unknown, webContentsId: unknown) => {
    if (typeof requestId === 'string') browserTargets.get(requestId)?.(typeof webContentsId === 'number' ? webContentsId : null)
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
        { name: 'Text and code', extensions: TEXT_EXTENSIONS },
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
  ipcMain.handle('omnibox:web', async (_event, query: unknown): Promise<string[]> => {
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
  })

  ipcMain.handle('omnibox:predict', async (_event, input: unknown): Promise<string[]> => {
    if (typeof input !== 'string' || !(await store.getSettings()).searchSuggestions) return []
    return predictQueries(input, GROQ_API_KEYS, (url, init) => net.fetch(url, init))
  })

  ipcMain.handle('browser:popout', (_event, url: string) => Boolean(popOutBrowser(url)))
  // Whether pages that use protected media (Spotify, Netflix and the like) can play here.
  ipcMain.handle('browser:protected-media', () => protectedMedia)

  /**
   * Orbis Search. The words are sent to the web and nothing else: no identifier, no history, nothing about who asked.
   * Orion's answer is a separate request the page makes only when it is worth one.
   */
  ipcMain.handle('search:run', async (_e, query: unknown, vertical: unknown) =>
    runSearch({
      query: typeof query === 'string' ? query : '',
      vertical: vertical === 'images' || vertical === 'videos' || vertical === 'news' ? vertical : 'all',
      fetchFn: (url, init) => net.fetch(url, init)
    })
  )

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

  // Account sign-in through the system browser (never an Orbis web view). Only state reaches windows, never codes or tokens.
  const auth = new AuthManager({
    provider: configuredProvider(),
    fetchFn: (url, init) => net.fetch(url, init),
    openExternal: (url) => shell.openExternal(url),
    secrets: protectedSessionFile(app.getPath('userData'), platform().secrets),
    onChange: (state) => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('auth:changed', state)
    },
    onReturn: () => {
      if (!mainWindow) return
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
  void auth.restore()
  ipcMain.handle('auth:state', () => auth.state())
  ipcMain.handle('auth:sign-in', () => auth.signIn())
  ipcMain.handle('auth:cancel', () => auth.cancel())
  ipcMain.handle('auth:sign-out', () => auth.signOut())

  ipcMain.handle('adblock:state', () => adblock?.state() ?? null)
  ipcMain.handle('adblock:settings', (_event, update: unknown) => (adblock && update && typeof update === 'object' ? adblock.updateSettings(update as Partial<AdBlockSettings>) : null))
  ipcMain.handle('adblock:site', (_event, host: unknown, allowed: unknown) => (adblock && typeof host === 'string' ? adblock.setSite(host, allowed === true) : null))
  ipcMain.handle('adblock:allow-resource', (_event, url: unknown) => (adblock && typeof url === 'string' ? adblock.allowResource(url) : null))
  ipcMain.handle('adblock:remove-exception', (_event, kind: unknown, value: unknown) =>
    adblock && (kind === 'site' || kind === 'resource') && typeof value === 'string' ? adblock.removeException(kind, value) : null
  )
  ipcMain.handle('adblock:report', (_event, webContentsId: unknown) => (adblock && typeof webContentsId === 'number' ? adblock.core.report(webContentsId) : null))
  ipcMain.handle('adblock:update', () => adblock?.updateFilters() ?? null)
  ipcMain.handle('adblock:rollback', () => adblock?.rollback() ?? null)

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

  ipcMain.handle('browser:clear-private', async () => {
    const privateSession = session.fromPartition('orbis-private')
    await Promise.all([privateSession.clearStorageData(), privateSession.clearCache(), privateSession.clearAuthCache()])
  })

  ipcMain.handle('browser:clear-data', () => clearBrowsingData())

  ipcMain.handle('image:edit', async (_event, request: ImageEditRequest): Promise<ImageEditResult> => {
    const instruction = String(request?.instruction ?? '').trim().slice(0, 2000)
    if (!instruction) throw new Error('Describe the edit first.')
    const prompt = String(request?.prompt ?? '').trim().slice(0, 1000)
    const seed = Number.isSafeInteger(request?.seed) ? request.seed : undefined
    const fetchFn = (url: string, init?: RequestInit): Promise<Response> => net.fetch(url, init)
    const nextPrompt = await rewriteImagePrompt(prompt, instruction, GROQ_API_KEYS, fetchFn)
    const image = await generateImage(nextPrompt, fetchFn, seed)
    return { url: image.dataUrl, prompt: nextPrompt, seed: image.seed }
  })

  ipcMain.handle('image:save', async (event, dataUrl: string, name: string) => {
    const match = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl)
    if (!match) return false
    const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()
    const safeName = (String(name).replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'orbis-image')
    const options = {
      title: 'Save image',
      defaultPath: join(app.getPath('downloads'), `${safeName}.${ext}`),
      filters: [{ name: 'Image', extensions: [ext] }]
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    await fs.writeFile(result.filePath, Buffer.from(match[2], 'base64'))
    return true
  })

  ipcMain.handle('voice:transcribe', async (_event, audioData: Uint8Array) => {
    if (GROQ_API_KEYS.length === 0) {
      throw new Error('No Groq API key available for transcription')
    }
    const audioBuffer = Buffer.from(audioData)
    for (const key of GROQ_API_KEYS) {
      try {
        return await transcribeAudio(audioBuffer, (url, init) => net.fetch(url, init), key)
      } catch (err) {
        const lastKey = key === GROQ_API_KEYS[GROQ_API_KEYS.length - 1]
        if (lastKey) throw err
      }
    }
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

/** Whether protected media (Widevine) is available, so Orbis can say so plainly instead of a page failing silently. */
let protectedMedia: { ready: boolean; status: unknown } = { ready: false, status: 'not checked yet' }

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

    // Protected media (Spotify, Netflix and the rest) plays through a content decryption module that is fetched and
    // kept up to date separately from Orbis. Waiting for it here means a tab never opens before it is ready; if it
    // cannot be had — no connection on first run, say — Orbis carries on without it and only DRM pages are affected.
    try {
      await components.whenReady()
      protectedMedia = { ready: true, status: components.status() }
    } catch (err) {
      protectedMedia = { ready: false, status: err instanceof Error ? err.message : String(err) }
    }

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

    registerIpc()
    // Ad blocking wires the browser session before any browser tab exists; its lists load in the background.
    adblock = new OrbisAdBlock({
      dataDir: join(app.getPath('userData'), 'adblock'),
      bundledDir: app.isPackaged ? join(process.resourcesPath, 'adblock') : join(app.getAppPath(), 'resources', 'adblock'),
      appPath: app.getAppPath(),
      session: session.fromPartition('persist:browser'),
      fetchFn: (url, init) => net.fetch(url, init),
      emit: (event) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('adblock:event', event)
      }
    })
    void adblock.start().catch((err: unknown) => console.error('[adblock] failed to start', err))
    browserLibrary = new BrowserLibrary(app.getPath('userData'))
    await browserLibrary.load()
    browser = new BrowserIntegration({
      getWindow: () => mainWindow,
      session: session.fromPartition('persist:browser'),
      library: browserLibrary,
      popOut: (url) => void popOutBrowser(url)
    })
    browser.setupSession()
    // Private tabs (Ctrl+Shift+N in the browser) share one in-memory session: downloads and permission prompts work,
    // ads are blocked, and nothing is written to disk or remembered.
    const privateSession = session.fromPartition('orbis-private')
    browser.setupSession(privateSession)
    adblock.attachSession(privateSession)
    browser.registerIpc()


    // Chrome Web Store extensions in the browser session. Requests extensions make of Orbis's tabs and toolbar are
    // carried out by the window, which answers with the affected tab's id.
    const windowRequests = new Map<string, (result: number | null) => void>()
    ipcMain.on('extensions:window-answer', (_event, requestId: unknown, result: unknown) => {
      if (typeof requestId === 'string') windowRequests.get(requestId)?.(typeof result === 'number' ? result : null)
    })
    const requestWindow = (request: WindowRequest): Promise<number | null> =>
      new Promise((resolve) => {
        if (!mainWindow || mainWindow.isDestroyed()) return resolve(null)
        const requestId = crypto.randomUUID()
        const timer = setTimeout(() => finish(null), 10_000)
        const finish = (result: number | null): void => {
          clearTimeout(timer)
          windowRequests.delete(requestId)
          resolve(result)
        }
        windowRequests.set(requestId, finish)
        mainWindow.webContents.send('extensions:window-request', { requestId, request })
      })
    const extensions = new ExtensionsManager({
      session: session.fromPartition('persist:browser'),
      getWindow: () => mainWindow,
      send: (channel, ...args) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
      },
      requestWindow
    })
    browser.setExtensionMenu((context) => extensions.menuItems(context))
    void extensions.start().catch((err: unknown) => console.error('[extensions] failed to start', err))
    ipcMain.handle('extensions:list', () => extensions.list())
    ipcMain.handle('extensions:set-enabled', (_event, id: unknown, enabled: unknown) => (typeof id === 'string' ? extensions.setEnabled(id, enabled === true) : undefined))
    ipcMain.handle('extensions:set-pinned', (_event, id: unknown, pinned: unknown) => (typeof id === 'string' ? extensions.setPinned(id, pinned === true) : undefined))
    ipcMain.handle('extensions:remove', (_event, id: unknown) => (typeof id === 'string' ? extensions.remove(id) : undefined))
    ipcMain.handle('extensions:update', async () => {
      const { before, after } = await extensions.update()
      return { updated: Object.keys(after).filter((id) => before[id] && before[id] !== after[id]).length }
    })
    ipcMain.handle('extensions:click-action', (_event, id: unknown) => (typeof id === 'string' ? extensions.clickAction(id) : { popup: null }))
    ipcMain.on('extensions:prompt-answer', (_event, requestId: unknown, allow: unknown) => {
      if (typeof requestId === 'string') extensions.answer(requestId, allow === true)
    })
    ipcMain.on('extensions:report-tabs', (_event, tabs: unknown) => {
      if (!Array.isArray(tabs)) return
      const valid = tabs.filter((t): t is ReportedTab => Boolean(t) && typeof t.id === 'number' && typeof t.index === 'number' && typeof t.url === 'string' && typeof t.title === 'string')
      extensions.updateTabs(valid)
    })

    const libraryForControl = browserLibrary
    const integrationForControl = browser
    browserControl = setupBrowserControl({
      getWindow: () => mainWindow,
      popOut: popOutBrowser,
      popouts: () => [...popouts],
      store,
      onSettingsChanged: (settings) => {
        nativeTheme.themeSource = settings.theme
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:changed', settings)
      },
      library: libraryForControl,
      integration: integrationForControl,
      extensions,
      openExtensionPopup: async (id) => void (await requestWindow({ kind: 'open-popup', extensionId: id })),
      adblock: () => adblock,
      session: session.fromPartition('persist:browser'),
      clearBrowsingData,
      sendShortcut: (action, index) => {
        if (!mainWindow || mainWindow.isDestroyed()) return false
        mainWindow.webContents.send('browser:shortcut', index ? { action, index } : { action })
        return true
      }
    })

    // Workflows: stored, versioned, recorded and run through the Browser Control Layer.
    const sendToWindow = (channel: string, ...args: unknown[]): void => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
    }
    const fetchForOrion = (url: string, init?: RequestInit): Promise<Response> => net.fetch(url, init)
    const workflowStore = new WorkflowStore(app.getPath('userData'), platform().secrets)
    workflowRecorder = new WorkflowRecorder({ getWindow: () => mainWindow, windowControl: browserControl.windowControl, library: libraryForControl, emit: (state) => sendToWindow('workflows:recording', state) })
    const workflows = new WorkflowEngine({
      control: browserControl.control,
      windowControl: browserControl.windowControl,
      store: workflowStore,
      library: libraryForControl,
      ask: (request, signal) => askOrion(request, GROQ_API_KEYS, fetchForOrion, signal),
      send: sendToWindow
    })
    registerWorkflowIpc({
      engine: workflows,
      recorder: workflowRecorder,
      store: workflowStore,
      control: browserControl.control,
      getWindow: () => mainWindow,
      draft: (instruction, current) => draftWorkflow(instruction, current, browserControl!.control.list(), GROQ_API_KEYS, fetchForOrion, () => crypto.randomUUID())
    })
    void workflows.start().catch((err: unknown) => console.error('[workflows] failed to start', err))
    app.on('before-quit', () => workflows.stop())

    // The Experience Runtime: everything the user personalises, kept apart from Orbis's own settings so the browser
    // works exactly as it always has until someone chooses otherwise.
    const experienceStore = new ExperienceStore(app.getPath('userData'))
    await experienceStore.load().catch((err: unknown) => console.error('[experience] could not be read', err))
    registerExperienceIpc({ store: experienceStore, control: browserControl.control, getWindow: () => mainWindow, send: sendToWindow })
    app.on('before-quit', () => void experienceStore.flush())

    // Profiles: separate browsing identities. Each has its own cookies, logins, site storage, history, bookmarks,
    // downloads and open pages; extensions are installed once and follow whichever profile is in use.
    const profilesStore = new ProfilesStore(app.getPath('userData'))

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
    void updates.start().catch((err: unknown) => console.error('[updates] failed to start', err))
    const preparedSessions = new Set<string>()
    /** Wires a profile's session the same way the first one is wired: ad blocking, downloads, permissions, new windows. */
    const useProfile = async (profile: Profile): Promise<Profile> => {
      const partition = profilesStore.partition(profile.id)
      const profileSession = session.fromPartition(partition)
      if (!preparedSessions.has(partition)) {
        preparedSessions.add(partition)
        browser?.setupSession(profileSession)
        adblock?.attachSession(profileSession)
      }
      await browserLibrary?.useDirectory(profilesStore.dataDir(profile.id))
      await extensions.useSession(profileSession).catch((err: unknown) => console.error('[profiles] extensions did not follow', err))
      sendToWindow('profiles:changed', { profile, partition })
      return profile
    }
    const switchProfile = async (id: string): Promise<{ profile: Profile; partition: string }> => {
      const profile = await profilesStore.setActive(id)
      await useProfile(profile)
      return { profile, partition: profilesStore.partition(profile.id) }
    }
    const startingProfile = await profilesStore.active()
    if (startingProfile.id !== 'default') await useProfile(startingProfile).catch((err: unknown) => console.error('[profiles] could not start in the last profile', err))

    // Notes, tasks and clipboard history: the user's own things, kept locally and reachable from the control layer.
    const notesStore = new NotesStore(app.getPath('userData'))
    const tasksStore = new TasksStore(app.getPath('userData'))
    const whiteboardStore = new WhiteboardStore(app.getPath('userData'))
    const workspacesStore = new WorkspacesStore(app.getPath('userData'))
    // A workspace that keeps itself up to date follows the window while it is the one that is open.
    browserControl.windowControl.onState((state) => workspacesStore.onBrowserState(state ? { tabs: state.tabs, groups: state.groups } : null))
    const clipboardHistory = new ClipboardHistory({
      clipboard: platform().clipboard,
      imageSize,
      userData: app.getPath('userData'),
      // Only watched while Orbis itself is in front, so copying elsewhere costs nothing.
      isActive: () => Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) || [...popouts].some((w) => !w.isDestroyed() && w.isFocused()),
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
    void clipboardHistory.start().catch((err: unknown) => console.error('[clipboard] failed to start', err))
    app.on('before-quit', () => {
      clipboardHistory.stop()
      workspacesStore.stop()
      void profilesStore.flush()
      void Promise.all([notesStore.flush(), tasksStore.flush(), clipboardHistory.flush(), whiteboardStore.flush(), workspacesStore.flush()])
    })

    app.on('before-quit', () => void browserLibrary?.flush())
    // Closing to make way for the installer still saves everything first; it is a restart, not a loss.
    app.on('before-quit', () => {
      updates?.stop()
      if (updatesQuitting) void updates?.getStatus()
    })
    mainWindow = createWindow()
    mainWindow.on('closed', () => (mainWindow = null))
    mainWindow.on('focus', () => extensions.bridge.setWindowFocused(true))
    mainWindow.on('blur', () => extensions.bridge.setWindowFocused(false))
  })

  app.on('window-all-closed', () => {
    for (const controller of activeRequests.values()) controller.abort()
    app.quit()
  })
}
