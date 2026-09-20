import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import type { BrowserLibrary } from './browserLibrary'
import { changeInChromium, mirrorChromiumInto, showDownload } from './browserMirror'
import type { MirrorSource } from './browserMirror'

/**
 * The IPC for the app's own browsing library: the shortcuts on the new-tab page, the searches and picks the address bar
 * remembers, bookmarks and the reading list the app keeps, and pictures of pages. Orbis's browser is Chromium, which keeps
 * its own history, bookmarks and downloads in its own profile; this is only what the Orbis window itself shows and edits.
 */
export function registerLibraryIpc(library: BrowserLibrary, getWindow: () => BrowserWindow | null, chromium: () => MirrorSource | null): void {
  /** Chromium's lists are copied in when the window asks (at most every few seconds), and after the window changes one. */
  let lastMirror = 0
  const refresh = async (force = false): Promise<void> => {
    const source = chromium()
    if (!source || (!force && Date.now() - lastMirror < 3000)) return
    lastMirror = Date.now()
    await mirrorChromiumInto(library, source).catch(() => undefined)
  }
  // The window shows the library live: it is told whenever anything in it changes (grouped, so a burst is one message).
  let queued: NodeJS.Timeout | null = null
  library.addListener(() => {
    if (queued) return
    queued = setTimeout(() => {
      queued = null
      const win = getWindow()
      if (win && !win.isDestroyed()) win.webContents.send('library:changed', library.snapshot())
    }, 150)
  })
  ipcMain.handle('library:get', async () => {
    await refresh()
    return library.snapshot()
  })
  ipcMain.handle('library:toggle-bookmark', async (_e, url: unknown, title: unknown) => {
    if (typeof url !== 'string') return false
    const source = chromium()
    if (!source) return false
    await refresh(true)
    const marked = library.isBookmarked(url)
    await changeInChromium(source, marked ? 'bookmarks.remove' : 'bookmarks.add', { url, title: typeof title === 'string' ? title : '' })
    await refresh(true)
    return library.isBookmarked(url)
  })
  ipcMain.handle('library:remove-history', async (_e, url: unknown) => {
    if (typeof url !== 'string') return
    const source = chromium()
    if (source) await changeInChromium(source, 'history.delete', { url })
    await refresh(true)
  })
  ipcMain.handle('library:record-search', (_e, query: unknown) => {
    if (typeof query === 'string') library.recordSearch(query)
  })
  ipcMain.handle('library:remove-search', (_e, query: unknown) => {
    if (typeof query === 'string') library.removeSearch(query)
  })
  ipcMain.handle('library:clear-searches', () => library.clearSearches())
  ipcMain.handle('library:record-pick', (_e, key: unknown) => {
    if (typeof key === 'string') library.recordPick(key)
  })
  ipcMain.handle('library:download-action', async (_e, id: unknown, action: unknown) => {
    const source = chromium()
    if (source && typeof id === 'string' && (action === 'show' || action === 'open')) await showDownload(source, id, action).catch(() => undefined)
  })
  ipcMain.handle('window:fullscreen', (event, on: unknown) => {
  const win = getWindow()
  if (!win || event.sender !== win.webContents) return false
  win.setFullScreen(typeof on === 'boolean' ? on : !win.isFullScreen())
  return win.isFullScreen()
  })
}
