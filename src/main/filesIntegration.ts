/**
 * Orbis Files integration — instantiates the Files subsystem inside Orbis's main process
 * and registers its IPC handlers so the renderer can reach them through window.orbis.
 */

import path from 'node:path'
import { copyFile, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, nativeImage, protocol, shell } from 'electron'
import { mediaResponse, thumbResponse } from '../files/main/mediaProtocol'
import { createServices, type Services } from '../files/main/services'
import { registerIpc, type HandlerContext } from '../files/main/ipcHandlers'
import { Logger } from '../files/main/log'
import type { EventChannel } from '../files/shared/ipc'
import { createOrionAdapter } from './filesOrionAdapter'
import { isOrbisOnly, setLibraryRoot, setOrbisOnly } from '../files/main/orbisScope'
import { setKnownLocations } from '../files/main/platform'

let filesServices: Services | null = null
let generatedDir: string | null = null
let downloadsDir: string | null = null

export interface FilesIntegrationOptions {
  profileId: string
  profileDir: string
  mainWindow: BrowserWindow
  appVersion: string
}

export async function initFilesIntegration(opts: FilesIntegrationOptions): Promise<Services> {
  const filesDir = path.join(opts.profileDir, 'files')
  const wasmDir = path.join(app.isPackaged ? process.resourcesPath : path.resolve('dist'), 'files', 'wasm')
  const logDir = path.join(filesDir, 'log')

  await mkdir(filesDir, { recursive: true })
  // Orbis-only mode is a switch (Files settings), off by default.
  const scopeFile = path.join(filesDir, 'scope.json')
  try {
    const saved = JSON.parse(await readFile(scopeFile, 'utf8')) as { orbisOnly?: boolean }
    setOrbisOnly(saved.orbisOnly === true)
  } catch {
    setOrbisOnly(false)
  }

  // The state set aside when Files was Orbis-only comes back once; the Orbis-only copy is kept beside it.
  const restored = path.join(filesDir, 'restore-v1')
  const aside = path.join(filesDir, 'before-orbis-only')
  if (!(await stat(restored).then(() => true, () => false))) {
    if (await stat(path.join(aside, 'orbis-files.db')).then(() => true, () => false)) {
      const keep = path.join(filesDir, 'orbis-only-state')
      await mkdir(keep, { recursive: true })
      const current = (await readdir(filesDir).catch(() => [] as string[])).filter((n) => n.startsWith('orbis-files.db'))
      for (const n of current) await rename(path.join(filesDir, n), path.join(keep, n)).catch(() => undefined)
      for (const n of await readdir(aside)) await rename(path.join(aside, n), path.join(filesDir, n)).catch(() => undefined)
    }
    await writeFile(restored, 'earlier Files state restored')
  }

  // Everything Orbis Files can see lives under one folder; the system's own folders are never listed.
  const library = path.join(filesDir, 'library')
  setLibraryRoot(library)
  for (const name of ['Downloads', 'Created', 'Saved', 'Imported']) await mkdir(path.join(library, name), { recursive: true })
  setKnownLocations([
    { id: 'home', label: 'Orbis', path: library },
    { id: 'downloads', label: 'Downloads', path: path.join(library, 'Downloads') },
    { id: 'pictures', label: 'Created by Orion', path: path.join(library, 'Created') },
    { id: 'documents', label: 'Saved', path: path.join(library, 'Saved') }
  ])

  const services = await createServices({
    profileId: opts.profileId,
    profileDir: filesDir,
    wasmDir,
    platform: {
      trash: async (p: string) => { await shell.trashItem(p) },
      trashSupported: true,
    },
    log: new Logger(logDir),
    appVersion: opts.appVersion,
  })

  const broadcast = (channel: EventChannel, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents.isDestroyed()) continue
      // The Files screen is a frame of its own; webContents.send would reach only the top frame.
      for (const frame of win.webContents.mainFrame.framesInSubtree) frame.send(`files:${channel}`, payload)
    }
  }

  const ctx: HandlerContext = {
    services,
    rendererDirUrl: '',
    openWindow: () => opts.mainWindow,
    broadcast,
    host: { status: 'connected' },
    logPath: logDir,
    dbPath: path.join(filesDir, 'orbis-files.db'),
    terminalClose: { allowClose: () => {} },
  }

  generatedDir = path.join(library, 'Created')
  downloadsDir = path.join(library, 'Downloads')
  void Promise.resolve(services.indexer.addRoot(library)).catch(() => undefined)
  ;(services as unknown as { mainWindow: BrowserWindow }).mainWindow = opts.mainWindow
  registerIpc(ctx, 'files:')
  filesServices = services

  // Wire Orion as the AI provider so Files can explain/summarise/analyse without separate config
  try {
    const adapter = createOrionAdapter()
    services.ai.configure(adapter, 'orbis-orion', { kind: 'orbis' as any })
    void services.ai.connect().catch((err: unknown) =>
      console.warn('[files] AI provider connect failed (non-fatal):', err)
    )
  } catch (err) {
    console.warn('[files] AI adapter setup failed (non-fatal):', err)
  }

  return services
}

export function getFilesServices(): Services | null {
  return filesServices
}

export async function stopFilesIntegration(): Promise<void> {
  if (!filesServices) return
  await filesServices.db?.close?.()
  filesServices = null
}

const DOWNLOAD_STATE: Record<string, 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'interrupted'> = {
  progressing: 'in_progress',
  paused: 'in_progress',
  completed: 'completed',
  cancelled: 'cancelled',
  interrupted: 'interrupted'
}

const seenDownloads = new Map<string, string>()

/** Tells Files about each browser download once per state change; nothing is invented, only what the browser reports. */
export function syncBrowserDownloads(
  downloads: Array<{ id: string; url: string; path: string; state: string; startedAt: number; finishedAt?: number }>
): void {
  if (!filesServices) return
  for (const d of downloads) {
    if (!d.path || !path.isAbsolute(d.path)) continue
    const state = DOWNLOAD_STATE[d.state]
    if (!state || seenDownloads.get(d.id) === state) continue
    seenDownloads.set(d.id, state)
    void (async () => {
      let stored = d.path
      if (state === 'completed' && downloadsDir && isOrbisOnly()) {
        // The file stays where the browser saved it; Orbis Files lists its own copy.
        const ext = path.extname(d.path)
        stored = path.join(downloadsDir, `${path.basename(d.path, ext)}-${d.id.slice(0, 6)}${ext}`)
        const size = (await stat(d.path)).size
        if (size > 2 * 1024 * 1024 * 1024) return
        if (!(await stat(stored).then(() => true, () => false))) await copyFile(d.path, stored)
      } else if (state !== 'completed') {
        return
      }
      filesServices?.catalog.registerDownload({
        path: stored,
        url: /^https?:\/\//.test(d.url) ? d.url : undefined,
        state,
        browser: 'orbis',
        startedMs: d.startedAt,
        finishedMs: d.finishedAt,
        source: 'host'
      })
    })().catch((err) => console.warn('[files] could not register download:', err))
    continue
  }
}

/** Saves a picture Orion made as a real file under the profile and lists it in Files as AI-generated. */
export async function registerGeneratedImage(dataUrl: string, prompt: string, chatId?: string): Promise<void> {
  if (!filesServices || !generatedDir) return
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) return
  try {
    await mkdir(generatedDir, { recursive: true })
    const file = path.join(generatedDir, `orion-${Date.now()}-${randomUUID().slice(0, 8)}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`)
    await writeFile(file, Buffer.from(m[2], 'base64'))
    filesServices.catalog.registerGenerated({
      path: file,
      generator: 'orbis-ai',
      chatId,
      prompt: prompt.slice(0, 4000),
      createdMs: Date.now()
    })
  } catch (err) {
    console.warn('[files] could not register generated image:', err)
  }
}

/** orbis-media: and orbis-thumb: let the Files screen show previews and thumbnails of local files, read-only. */
export function registerFilesProtocols(filesDir: string): void {
  const thumbDir = path.join(filesDir, 'thumbs')
  protocol.handle('orbis-media', (request) => mediaResponse(request.url, request.headers.get('range')))
  protocol.handle('orbis-thumb', (request) =>
    thumbResponse(request.url, thumbDir, async (p, size) => {
      let img = nativeImage.createFromPath(p)
      if (img.isEmpty() && process.platform !== 'linux') {
        img = await nativeImage.createThumbnailFromPath(p, { width: size, height: size }).catch(() => nativeImage.createEmpty())
      }
      if (img.isEmpty()) return undefined
      const { width, height } = img.getSize()
      const scale = Math.min(1, size / Math.max(width, height))
      return img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' }).toJPEG(82)
    })
  )
}
