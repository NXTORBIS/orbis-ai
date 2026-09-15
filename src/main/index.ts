import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, net, session, shell, webContents } from 'electron'
import type { MenuItemConstructorOptions, OpenDialogOptions, TitleBarOverlayOptions, WebContents } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import { basename, join } from 'node:path'
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
function popOutBrowser(url: string): boolean {
  if (typeof url !== 'string' || !isHttpUrl(url)) return false
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
  return true
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

  // The in-app browser gets no preload or Node access, and only loads web URLs.
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    // Web pages, and "view page source" of a web page.
    if (!isHttpUrl(params.src) && !/^view-source:https?:\/\//i.test(params.src)) event.preventDefault()
  })
  browser?.attachWindow(win)
  // Links that would open a new window open as a tab in the in-app browser instead (Ctrl/middle-click in the background,
  // Shift+click in a new window); ad popups and ad redirects are stopped by ad blocking.
  win.webContents.on('did-attach-webview', (_event, contents) => {
    browser?.attachGuest(contents)
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
      const systemPrompt = buildSystemPrompt(settings, request.persona)
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
              getTarget: () => requestBrowserTarget(request.requestId, sender, emit, controller.signal),
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

  ipcMain.handle('browser:popout', (_event, url: string) => popOutBrowser(url))

  // Account sign-in through the system browser (never an Orbis web view). Only state reaches windows, never codes or tokens.
  const auth = new AuthManager({
    provider: configuredProvider(),
    fetchFn: (url, init) => net.fetch(url, init),
    openExternal: (url) => shell.openExternal(url),
    secrets: protectedSessionFile(app.getPath('userData')),
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

  ipcMain.handle('browser:clear-data', async () => {
    const browserSession = session.fromPartition('persist:browser')
    await Promise.all([browserSession.clearStorageData(), browserSession.clearCache()])
    // Browsing data includes the history and the permissions sites were given; bookmarks and downloads stay.
    browserLibrary?.clearHistory()
    browserLibrary?.clearSearches()
    browserLibrary?.forgetPermissions()
  })

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

    store = new Store(app.getPath('userData'))
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
    browser.registerIpc()
    app.on('before-quit', () => void browserLibrary?.flush())
    mainWindow = createWindow()
    mainWindow.on('closed', () => (mainWindow = null))
  })

  app.on('window-all-closed', () => {
    for (const controller of activeRequests.values()) controller.abort()
    app.quit()
  })
}
