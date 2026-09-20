import type { BrowserBookmark, BrowserDownload, BrowserHistoryEntry } from '../shared/types'
import type { BrowserControl } from './browserControl/registry.ts'
import type { BrowserLibrary } from './browserLibrary'

/** What the mirror needs of the running browser. */
export interface MirrorSource {
  control: BrowserControl
  bridge: { run<T>(expression: string): Promise<T> }
}

const ask = async <T>(source: MirrorSource, capability: string, params: Record<string, unknown>): Promise<T[]> => {
  const result = await source.control.execute({ capability, params, source: 'user' }, { confirm: async () => true })
  return result.ok && Array.isArray(result.data) ? (result.data as T[]) : []
}

/**
 * Copies Chromium's own history, bookmarks and downloads into the app's library, which the address-bar suggestions, the
 * new-tab widgets and Galaxy read. Chromium is the source of truth: these are read from it, on demand, not kept by Orbis.
 */
export async function mirrorChromiumInto(library: BrowserLibrary, source: MirrorSource): Promise<void> {
  const [history, bookmarks, downloads] = await Promise.all([
    ask<{ url: string; title: string; visitedAt: number }>(source, 'history.search', { limit: 500 }),
    ask<{ url: string; title: string; addedAt: number }>(source, 'bookmarks.list', {}),
    ask<BrowserDownload & { startedAt: number }>(source, 'downloads.list', { limit: 100 })
  ])
  library.mirrorBrowser({
    history: history.map((h): BrowserHistoryEntry => ({ url: h.url, title: h.title, visitedAt: Math.round(h.visitedAt) })),
    bookmarks: bookmarks.map((b): BrowserBookmark => ({ url: b.url, title: b.title, addedAt: b.addedAt })),
    downloads: downloads.map((d): BrowserDownload => ({ id: String(d.id), url: d.url, filename: d.filename, path: d.path, state: d.state, receivedBytes: d.receivedBytes, totalBytes: d.totalBytes, startedAt: d.startedAt }))
  })
}

/** A change made in the Orbis window to something Chromium owns is made in Chromium; the copy is refreshed afterwards. */
export async function changeInChromium(source: MirrorSource, capability: string, params: Record<string, unknown>): Promise<boolean> {
  const result = await source.control.execute({ capability, params, source: 'user' }, { confirm: async () => true })
  return result.ok
}

export const showDownload = (source: MirrorSource, id: string, action: 'show' | 'open'): Promise<unknown> => source.bridge.run(`chrome.downloads.${action}(${Number(id)})`)
