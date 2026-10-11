import { plainHandle } from './ipc/handle.ts'
import type { BrowserWindow } from 'electron'
import type { BrowserLibrary } from './browserLibrary'
import { changeInChromium, mirrorChromiumInto, showDownload } from './browserMirror'
import type { MirrorSource } from './browserMirror'

/**
 * The IPC for the app's own browsing library: the shortcuts on the new-tab page, the searches and picks the address bar
 * remembers, bookmarks and the reading list the app keeps, and pictures of pages. Orbis's browser is Chromium, which keeps
 * its own history, bookmarks and downloads in its own profile; this is only what the Orbis window itself shows and edits.
 *
 * **Eight of these nine channels did not check who was asking.** One did -- `window:fullscreen` -- so the file read
 * as though the question had been considered. It had not. `library:get` returns the mirrored copy of Chromium's own
 * history, bookmarks and downloads along with everything the address bar remembers; `library:remove-history` deletes
 * from Chromium's history; `library:toggle-bookmark` writes its bookmarks; and `library:download-action` calls
 * `chrome.downloads.open(Number(id))`, which opens a downloaded file with whatever the system opens it with, from a
 * small whole number anybody could count up through.
 *
 * All nine go through the shared check now. The one that already checked also gets the destroyed-window test it was
 * missing: it read `win.webContents` after testing only for null, and on a window that has closed that throws.
 */
export function registerLibraryIpc(library: BrowserLibrary, getWindow: () => BrowserWindow | null, chromium: () => MirrorSource | null): void {
  const handle = plainHandle({ getWindow })
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
  handle('library:get', async () => {
    await refresh()
    return library.snapshot()
  })
  handle('library:toggle-bookmark', async (_event, url: unknown, title: unknown) => {
    if (typeof url !== 'string') return false
    const source = chromium()
    if (!source) return false
    await refresh(true)
    const marked = library.isBookmarked(url)
    await changeInChromium(source, marked ? 'bookmarks.remove' : 'bookmarks.add', { url, title: typeof title === 'string' ? title : '' })
    await refresh(true)
    return library.isBookmarked(url)
  })
  handle('library:remove-history', async (_event, url: unknown) => {
    if (typeof url !== 'string') return
    const source = chromium()
    if (source) await changeInChromium(source, 'history.delete', { url })
    await refresh(true)
  })
  handle('library:record-search', (_event, query: unknown) => {
    if (typeof query === 'string') library.recordSearch(query)
  })
  handle('library:remove-search', (_event, query: unknown) => {
    if (typeof query === 'string') library.removeSearch(query)
  })
  handle('library:clear-searches', () => library.clearSearches())
  handle('library:record-pick', (_event, key: unknown) => {
    if (typeof key === 'string') library.recordPick(key)
  })
  handle('library:download-action', async (_event, id: unknown, action: unknown) => {
    const source = chromium()
    if (source && typeof id === 'string' && (action === 'show' || action === 'open')) await showDownload(source, id, action).catch(() => undefined)
  })
  handle('window:fullscreen', (_event, on: unknown) => {
    const win = getWindow()
    if (!win) return false
    win.setFullScreen(typeof on === 'boolean' ? on : !win.isFullScreen())
    return win.isFullScreen()
  })
}
