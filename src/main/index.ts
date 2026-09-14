import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, net, shell } from 'electron'
import type { MenuItemConstructorOptions, OpenDialogOptions, TitleBarOverlayOptions } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import { basename, join } from 'node:path'
import type { ChatRequest, Conversation, PickedFiles, SettingsUpdate, StreamEvent } from '../shared/types'
import { streamChat, testApiKey } from './nim'
import { buildSystemPrompt } from './prompt'
import { formatResults, searchWeb } from './websearch'
import { Store } from './store'

// Baked in at build time from GROQ_API_KEY in .env.local (see electron.vite.config.ts).
declare const __GROQ_API_KEYS__: string[]
const GROQ_API_KEYS: string[] = typeof __GROQ_API_KEYS__ === 'undefined' ? [] : __GROQ_API_KEYS__

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
      else picked.attachments.push({ name, content: buffer.toString('utf8') })
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
    if (!isHttpUrl(params.src)) event.preventDefault()
  })
  win.webContents.on('did-attach-webview', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (isHttpUrl(url)) void contents.loadURL(url)
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
    mainWindow?.setTitleBarOverlay(titleBarOverlayFor(nativeTheme.shouldUseDarkColors))
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
      const query = request.webSearch && last?.role === 'user' ? last.content.trim() : undefined
      if (last && query) {
        emit({ type: 'status', message: 'Searching the web…' })
        try {
          const results = await searchWeb(query, (url, init) => net.fetch(url, init), controller.signal)
          // Kept inside the user message so the results sit right next to the question they answer.
          messages = [...messages.slice(0, -1), { ...last, content: `${formatResults(query, results)}\n\nQuestion: ${last.content}` }]
        } catch (err) {
          if (controller.signal.aborted) return emit({ type: 'aborted' })
          emit({ type: 'status', message: `Web search failed (${err instanceof Error ? err.message : String(err)}), answering without it.` })
        }
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
    mainWindow = createWindow()
    nativeTheme.on('updated', () => mainWindow?.setTitleBarOverlay(titleBarOverlayFor(nativeTheme.shouldUseDarkColors)))
    mainWindow.on('closed', () => (mainWindow = null))
  })

  app.on('window-all-closed', () => {
    for (const controller of activeRequests.values()) controller.abort()
    app.quit()
  })
}
