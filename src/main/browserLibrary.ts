import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BrowserBookmark, BrowserDownload, BrowserHistoryEntry, BrowserLibrarySnapshot, BrowserPick, BrowserSearchEntry, SiteShortcut } from '../shared/types'

const MAX_SEARCHES = 300
const MAX_PICKS = 500
export const MAX_SHORTCUTS = 24

interface LibraryFile {
  history: BrowserHistoryEntry[]
  bookmarks: BrowserBookmark[]
  downloads: BrowserDownload[]
  searches: BrowserSearchEntry[]
  picks: Record<string, BrowserPick>
  shortcuts: SiteShortcut[]
}

const EMPTY = (): LibraryFile => ({ history: [], bookmarks: [], downloads: [], searches: [], picks: {}, shortcuts: [] })

/** Pages the browser should never record (its own blank and error pages). */
const recordable = (url: string): boolean => /^https?:\/\//i.test(url)

/** A key for "the same page": no fragment. */
const pageKey = (url: string): string => url.split('#')[0]

const cleanQuery = (query: string): string => query.replace(/\s+/g, ' ').trim().slice(0, 200)

/** A shortcut's address: a web URL (https:// added when missing), or null. */
function shortcutUrl(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    if (!/^https?:$/.test(url.protocol) || (!url.hostname.includes('.') && url.hostname !== 'localhost')) return null
    return url.toString()
  } catch {
    return null
  }
}

/** A shortcut's name: what the user typed, or the site's host. */
const shortcutName = (name: string, url: string): string => name.replace(/\s+/g, ' ').trim().slice(0, 40) || new URL(url).hostname.replace(/^www\./, '')

const validIcon = (icon: unknown): icon is string => typeof icon === 'string' && /^data:image\/(png|jpeg|gif|webp|x-icon|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(icon) && icon.length < 420_000

/**
 * The browser's history, bookmarks, downloads list, recent address-bar searches, which
 * suggestions the user picks, and the new-tab page's shortcuts, kept in one JSON file under the user's data folder.
 * Writes are debounced and atomic (a temporary file is renamed over the old one).
 */
export class BrowserLibrary {
  private data: LibraryFile = EMPTY()
  /** Lists an earlier Orbis kept here (a reading list, saved pages, pictures of pages) that no longer have a screen: kept as they were, never dropped. */
  private legacy: Record<string, unknown> = {}
  private saveTimer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()
  private file: string
  /** Called after any change, so open windows can refresh. */
  onChange?: () => void

  private readonly now: () => number

  constructor(dir: string, now: () => number = Date.now) {
    this.file = join(dir, 'browser-library.json')
    this.now = now
  }

  /** Where this profile's library is kept. */
  directory(): string {
    return dirname(this.file)
  }

  /**
   * Points the library at another profile's folder: what is in memory is written out first, then that profile's own
   * history, bookmarks and downloads are read in.
   */
  async useDirectory(dir: string): Promise<void> {
    const next = join(dir, 'browser-library.json')
    if (next === this.file) return
    await this.flush()
    this.file = next
    await this.load()
    this.changed()
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<LibraryFile> & Record<string, unknown>
      this.legacy = Object.fromEntries(['readingList', 'savedPages', 'screenshots'].filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]))
      this.data = {
        history: Array.isArray(raw.history) ? raw.history.filter((h) => h && typeof h.url === 'string') : [],
        bookmarks: Array.isArray(raw.bookmarks) ? raw.bookmarks.filter((b) => b && typeof b.url === 'string') : [],
        // Downloads still in progress when Orbis closed can't continue; they are shown as interrupted.
        downloads: Array.isArray(raw.downloads) ? raw.downloads.map((d) => (d.state === 'progressing' ? { ...d, state: 'interrupted' as const } : d)) : [],
        searches: Array.isArray(raw.searches) ? raw.searches.filter((s) => s && typeof s.query === 'string' && typeof s.searchedAt === 'number') : [],
        picks: raw.picks && typeof raw.picks === 'object' ? raw.picks : {},
        shortcuts: Array.isArray(raw.shortcuts)
          ? raw.shortcuts
              .filter((s) => s && typeof s.id === 'string' && typeof s.url === 'string' && shortcutUrl(s.url))
              .map((s) => ({ id: s.id, name: shortcutName(String(s.name ?? ''), shortcutUrl(s.url)!), url: shortcutUrl(s.url)!, addedAt: Number(s.addedAt) || 0, ...(validIcon(s.icon) ? { icon: s.icon } : s.icon === null ? { icon: null } : {}) }))
              .slice(0, MAX_SHORTCUTS)
          : []
      }
    } catch {
      // No library yet, or a damaged file: start empty rather than failing the browser.
      this.data = EMPTY()
      this.legacy = {}
    }
  }

  private readonly listeners = new Set<() => void>()

  /** Hears every change (besides onChange); returns the function that stops listening. */
  addListener(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private changed(): void {
    this.onChange?.()
    for (const listener of this.listeners) listener()
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.flush()
    }, 800)
  }

  /** Writes now. Any save waiting on the timer is folded into this one, and writes never overlap each other. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    const data = JSON.stringify({ ...this.data, ...this.legacy })
    this.writing = this.writing.then(async () => {
      const dir = join(this.file, '..')
      await mkdir(dir, { recursive: true })
      const temp = `${this.file}.tmp`
      await writeFile(temp, data)
      await rename(temp, this.file)
    })
    return this.writing
  }

  snapshot(): BrowserLibrarySnapshot {
    return {
      history: this.data.history.slice(0, 1000),
      bookmarks: [...this.data.bookmarks],
      downloads: [...this.data.downloads],
      searches: this.data.searches.slice(0, 100),
      picks: { ...this.data.picks },
      shortcuts: this.data.shortcuts.map((s) => ({ ...s }))
    }
  }

  // ---------------------------------------------------------------- address bar searches and learning

  /** Records a search run from the address bar; repeats move it to the top and count up. */
  recordSearch(query: string): void {
    const text = cleanQuery(query)
    if (!text) return
    const key = text.toLowerCase()
    const known = this.data.searches.find((s) => s.query.toLowerCase() === key)
    const entry: BrowserSearchEntry = { query: text, searchedAt: this.now(), count: (known?.count ?? 0) + 1 }
    this.data.searches = [entry, ...this.data.searches.filter((s) => s !== known)].slice(0, MAX_SEARCHES)
    this.changed()
  }

  /** Forgets a search the address bar remembered (Chromium's own history is the browser's to keep). */
  removeSearch(query: string): void {
    const key = cleanQuery(query).toLowerCase()
    if (!key) return
    this.data.searches = this.data.searches.filter((s) => s.query.toLowerCase() !== key)
    delete this.data.picks[`q:${key}`]
    this.changed()
  }

  clearSearches(): void {
    this.data.searches = []
    this.data.picks = Object.fromEntries(Object.entries(this.data.picks).filter(([key]) => !key.startsWith('q:')))
    this.changed()
  }

  /** The user chose a suggestion; its key ranks higher next time. */
  recordPick(key: string): void {
    if (!/^[uq]:.{1,600}$/s.test(key)) return
    const known = this.data.picks[key]
    this.data.picks[key] = { count: (known?.count ?? 0) + 1, lastAt: this.now() }
    const keys = Object.keys(this.data.picks)
    if (keys.length > MAX_PICKS) {
      for (const old of keys.sort((a, b) => this.data.picks[a].lastAt - this.data.picks[b].lastAt).slice(0, keys.length - MAX_PICKS)) delete this.data.picks[old]
    }
    this.changed()
  }

  // ---------------------------------------------------------------- new-tab shortcuts

  shortcut(id: string): SiteShortcut | undefined {
    return this.data.shortcuts.find((s) => s.id === id)
  }

  /** Adds a shortcut at the end; null when the address isn't a web site or the page is full. Its icon comes later. */
  addShortcut(name: string, url: string): SiteShortcut | null {
    const address = shortcutUrl(url)
    if (!address || this.data.shortcuts.length >= MAX_SHORTCUTS) return null
    const shortcut: SiteShortcut = { id: randomUUID(), name: shortcutName(name, address), url: address, addedAt: this.now() }
    this.data.shortcuts.push(shortcut)
    this.changed()
    return { ...shortcut }
  }

  /** Renames a shortcut or changes its address; a new address drops the old icon until the new one is fetched. */
  updateShortcut(id: string, name: string, url: string): SiteShortcut | null {
    const shortcut = this.shortcut(id)
    const address = shortcutUrl(url)
    if (!shortcut || !address) return null
    if (address !== shortcut.url) delete shortcut.icon
    shortcut.url = address
    shortcut.name = shortcutName(name, address)
    this.changed()
    return { ...shortcut }
  }

  /** The fetched icon (a data URL), or null when the site has none. Ignored if the address changed meanwhile. */
  setShortcutIcon(id: string, forUrl: string, icon: string | null): void {
    const shortcut = this.shortcut(id)
    if (!shortcut || shortcut.url !== forUrl) return
    if (icon !== null && !validIcon(icon)) return
    shortcut.icon = icon
    this.changed()
  }

  removeShortcut(id: string): void {
    const before = this.data.shortcuts.length
    this.data.shortcuts = this.data.shortcuts.filter((s) => s.id !== id)
    if (this.data.shortcuts.length !== before) this.changed()
  }

  // ---------------------------------------------------------------- bookmarks

  isBookmarked(url: string): boolean {
    return this.data.bookmarks.some((b) => pageKey(b.url) === pageKey(url))
  }

  // ---------------------------------------------------------------- Chromium's own lists

  /**
   * Replaces the history, bookmarks and downloads shown in the Orbis window with what the Orbis browser (Chromium) has: they live
   * in the browser's own profile, and this is a copy for the address-bar suggestions, the new-tab widgets and Galaxy. Nothing else in the
   * library (shortcuts, searches, what the address bar learned) is touched. Listeners are told only when something differs.
   */
  mirrorBrowser(lists: { history: BrowserHistoryEntry[]; bookmarks: BrowserBookmark[]; downloads: BrowserDownload[] }): void {
    const next = { history: lists.history.filter((h) => recordable(h.url)).slice(0, 1000), bookmarks: lists.bookmarks.filter((b) => recordable(b.url)), downloads: lists.downloads.slice(0, 200) }
    if (JSON.stringify(next) === JSON.stringify({ history: this.data.history, bookmarks: this.data.bookmarks, downloads: this.data.downloads })) return
    this.data.history = next.history
    this.data.bookmarks = next.bookmarks
    this.data.downloads = next.downloads
    this.changed()
  }
}
