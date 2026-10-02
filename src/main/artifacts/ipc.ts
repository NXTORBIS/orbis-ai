import { app, BrowserWindow, dialog, ipcMain, type BrowserWindow as BrowserWindowType, type IpcMainInvokeEvent } from 'electron'
import { randomBytes } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FORMATS } from '../../shared/compute/interchange.ts'
import type { ArtifactService, DestinationRequest } from './service.ts'

/**
 * How the Orbis interface reaches the artifact service, and the two Electron things the service needs.
 *
 * One channel. Everything goes through `creation:run` and the service's own operation map, for the reason
 * `pages:compute` is one channel: one door means one place the sender is checked and one place an operation is
 * refused. A second channel would be a second copy of both.
 *
 * This is the only file in `main/artifacts` that may import Electron. The service and the store know nothing about
 * windows, dialogs or print engines; the save dialog and the PDF printer are built here and handed in as functions,
 * so the service can be tested against a folder and a stub, and so the whole Electron surface of the feature is this
 * file. In Chromium it becomes a Mojo interface, `SelectFileDialog`, and a headless print of the same HTML.
 */

export interface ArtifactsIpcOptions {
  service: ArtifactService
  profileId(): Promise<string>
  getWindow(): BrowserWindowType | null
}

/**
 * Where to write, asked in the main process.
 *
 * The dialog runs here rather than a path arriving from the renderer, which is the difference between writing where
 * the person pointed and writing anywhere a renderer asks for.
 */
export const chooseDestinationWith =
  (getWindow: () => BrowserWindowType | null) =>
  async (request: DestinationRequest): Promise<string | null> => {
    const win = getWindow()
    const options = { title: request.title, defaultPath: request.defaultName, filters: request.filters }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    return result.canceled || !result.filePath ? null : result.filePath
  }

/**
 * Which file to read, asked in the main process.
 *
 * The filter lists every extension the format registry says Orbis reads, so the dialog and the reader cannot
 * disagree about what can be opened.
 */
export const chooseSourceWith =
  (getWindow: () => BrowserWindowType | null) =>
  async (): Promise<string | null> => {
    const win = getWindow()
    const readable = Object.values(FORMATS)
      .filter((one) => one.canImport)
      .flatMap((one) => one.extensions.map((ext) => ext.replace(/^\./, '')))
    const options = {
      title: 'Open a file',
      properties: ['openFile' as const],
      filters: [
        { name: 'Files Orbis reads', extensions: readable },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }

/** How long a print may take before it is given up on. A document of a few hundred pages prints in seconds. */
const PRINT_TIMEOUT_MS = 60_000

/**
 * HTML printed to PDF by Chromium's own print engine, in a window nobody sees.
 *
 * The HTML is Orbis's own -- written by `toHtml` from blocks that were read through an allow-list -- and it is loaded
 * with JavaScript switched off, in its own in-memory session, with a policy that forbids every fetch. So the window
 * can run nothing, reach nothing, and keep nothing. It is destroyed as soon as the bytes are back, and the file it
 * loaded from is removed in the same breath.
 *
 * Chosen over printing through the browser's tab for three reasons: it returns bytes rather than leaving a file in
 * Downloads, it needs no server to put the HTML on an address a tab can load, and it works with the browser closed.
 */
export const renderPdfWith =
  () =>
  async (html: string): Promise<Uint8Array> => {
    const token = randomBytes(8).toString('hex')
    const path = join(app.getPath('temp'), `orbis-print-${token}.html`)
    await writeFile(path, html, { encoding: 'utf8', mode: 0o600 })

    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: {
        // Every one of these visible here, because this is the list somebody reads to know what the print window can do.
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        javascript: false,
        webSecurity: true,
        spellcheck: false,
        devTools: false,
        webviewTag: false,
        enableWebSQL: false,
        backgroundThrottling: false,
        // In memory and its own: nothing it loads is cached or shared with any other window.
        partition: `print-${token}`
      }
    })
    try {
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.on('will-navigate', (event) => event.preventDefault())
      await win.loadFile(path)
      const printed = win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.7, bottom: 0.7, left: 0.65, right: 0.65 },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate:
          '<div style="font-size:8px;width:100%;text-align:center;color:#8a8f99;font-family:Segoe UI,system-ui,sans-serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
      })
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Printing took longer than a minute and was stopped.')), PRINT_TIMEOUT_MS))
      const buffer = await Promise.race([printed, timeout])
      return new Uint8Array(buffer)
    } finally {
      if (!win.isDestroyed()) win.destroy()
      await rm(path, { force: true }).catch(() => undefined)
    }
  }

export function registerArtifactsIpc(o: ArtifactsIpcOptions): void {
  ipcMain.handle('creation:run', async (event: IpcMainInvokeEvent, request: unknown) => {
    if (event.sender !== o.getWindow()?.webContents) throw new Error('Not allowed.')
    try {
      return await o.service.run(await o.profileId(), request)
    } catch (err) {
      // A code and a sentence. Never a stack, and never a path.
      return {
        ok: false,
        operation: '',
        error: 'failed',
        message: err instanceof Error && err.message.length < 200 ? err.message : 'That did not work.'
      }
    }
  })
}
