import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { ArtifactService, DestinationRequest } from './service.ts'

/**
 * How the Orbis interface reaches the artifact service, and the one Electron thing the service needs.
 *
 * One channel. Everything goes through `creation:run` and the service's own operation map, for the reason
 * `pages:compute` is one channel: one door means one place the sender is checked and one place an operation is
 * refused. A second channel would be a second copy of both.
 *
 * This is the only file in `main/artifacts` that may import Electron. The service and the store know nothing about
 * windows or dialogs; the save dialog is built here and handed in as a function, so the service can be tested against
 * a folder and so the whole Electron surface of the feature is this file. In Chromium it becomes a Mojo interface and
 * `SelectFileDialog`.
 */

export interface ArtifactsIpcOptions {
  service: ArtifactService
  profileId(): Promise<string>
  getWindow(): BrowserWindow | null
}

/**
 * Where to write, asked in the main process.
 *
 * The dialog runs here rather than a path arriving from the renderer, which is the difference between writing where
 * the person pointed and writing anywhere a renderer asks for.
 */
export const chooseDestinationWith =
  (getWindow: () => BrowserWindow | null) =>
  async (request: DestinationRequest): Promise<string | null> => {
    const win = getWindow()
    const options = { title: request.title, defaultPath: request.defaultName, filters: request.filters }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    return result.canceled || !result.filePath ? null : result.filePath
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
