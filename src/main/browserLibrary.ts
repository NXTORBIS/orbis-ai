import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BrowserBookmark, BrowserDownload, BrowserHistoryEntry, BrowserLibrarySnapshot, BrowserPick, BrowserSearchEntry, SiteShortcut, SitePermissionDecision } from '../shared/types'

const MAX_HISTORY = 5000
/** A revisit of the same page within this window updates the entry instead of adding another. */
const REVISIT_MS = 30 * 60_000
const MAX_DOWNLOADS = 200
const MAX_SEARCHES = 300
const MAX_PICKS = 500
export const MAX_SHORTCUTS = 24

interface LibraryFile {
  history: BrowserHistoryEntry[]
  bookmarks: BrowserBookmark[]
  downloads: BrowserDownload[]
  permissions: Record<string, SitePermissionDecision>
  searches: BrowserSearchEntry[]
  picks: Record<string, BrowserPick>
  shortcuts: SiteShortcut[]
}

const EMPTY = (): LibraryFile => ({ history: [], bookmarks: [], downloads: [], permissions: {}, searches: [], picks: {}, shortcuts: [] })

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
 * The browser's history, bookmarks, downloads list, remembered site permissions, recent address-bar searches, which
 * suggestions the user picks, and the new-tab page's shortcuts, kept in one JSON file under the user's data folder.
 * Writes are debounced and atomic (a temporary file is renamed over the old one).
 */
export class BrowserLibrary {
  private data: LibraryFile = EMPTY()
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

  /**
   * Points the library at another profile's folder: what is in memory is written out first, then that profile's own
   * history, bookmarks, downloads and site permissions are read in.
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
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<LibraryFile>
      this.data = {
        history: Array.isArray(raw.history) ? raw.history.filter((h) => h && typeof h.url === 'string') : [],
        bookmarks: Array.isArray(raw.bookmarks) ? raw.bookmarks.filter((b) => b && typeof b.url === 'string') : [],
        // Downloads still in progress when Orbis closed can't continue; they are shown as interrupted.
        downloads: Array.isArray(raw.downloads) ? raw.downloads.map((d) => (d.state === 'progressing' ? { ...d, state: 'interrupted' as const } : d)) : [],
        permissions: raw.permissions && typeof raw.permissions === 'object' ? raw.permissions : {},
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
    const data = JSON.stringify(this.data)
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
      permissions: { ...this.data.permissions },
      searches: this.data.searches.slice(0, 100),
      picks: { ...this.data.picks },
      shortcuts: this.data.shortcuts.map((s) => ({ ...s }))
    }
  }

  // ---------------------------------------------------------------- history

  /** Records a visit. A revisit of the same page soon after updates the existing entry. */
  visit(url: string, title = ''): void {
    if (!recordable(url)) return
    const key = pageKey(url)
    const time = this.now()
    const latest = this.data.history.find((h) => pageKey(h.url) === key)
    if (latest && time - latest.visitedAt < REVISIT_MS) {
      latest.visitedAt = time
      if (title) latest.title = title
      this.data.history = [latest, ...this.data.history.filter((h) => h !== latest)]
    } else {
      this.data.history.unshift({ url, title, visitedAt: time })
      if (this.data.history.length > MAX_HISTORY) this.data.history.length = MAX_HISTORY
    }
    this.changed()
  }

  /** A page's title arrived after the visit was recorded. */
  retitle(url: string, title: string): void {
    const entry = this.data.history.find((h) => pageKey(h.url) === pageKey(url))
    if (!entry || !title || entry.title === title) return
    entry.title = title
    const bookmark = this.data.bookmarks.find((b) => pageKey(b.url) === pageKey(url))
    if (bookmark && !bookmark.title) bookmark.title = title
    this.changed()
  }

  /** History entries, newest first, filtered by text (URL or title) and visit time. */
  searchHistory(options: { query?: string; from?: number; to?: number; limit?: number }): BrowserHistoryEntry[] {
    const q = options.query?.toLowerCase().trim()
    const out: BrowserHistoryEntry[] = []
    const limit = Math.max(1, Math.min(options.limit ?? 100, MAX_HISTORY))
    for (const h of this.data.history) {
      if (q && !h.url.toLowerCase().includes(q) && !h.title.toLowerCase().includes(q)) continue
      if (options.from !== undefined && h.visitedAt < options.from) continue
      if (options.to !== undefined && h.visitedAt > options.to) continue
      out.push({ ...h })
      if (out.length >= limit) break
    }
    return out
  }

  /** Removes the entries visited between two times; returns how many. */
  removeHistoryRange(from: number, to: number): number {
    const before = this.data.history.length
    this.data.history = this.data.history.filter((h) => h.visitedAt < from || h.visitedAt > to)
    const removed = before - this.data.history.length
    if (removed) this.changed()
    return removed
  }

  removeHistory(url: string): void {
    const before = this.data.history.length
    this.data.history = this.data.history.filter((h) => pageKey(h.url) !== pageKey(url))
    if (this.data.history.length !== before) this.changed()
  }

  /** Clears history and what was learned from it (suggestion picks). */
  clearHistory(): void {
    this.data.history = []
    this.data.picks = {}
    this.changed()
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

  /** Forgets a search, including the matching search result pages in history. */
  removeSearch(query: string): void {
    const key = cleanQuery(query).toLowerCase()
    if (!key) return
    this.data.searches = this.data.searches.filter((s) => s.query.toLowerCase() !== key)
    this.data.history = this.data.history.filter((h) => searchedFor(h.url) !== key)
    delete this.data.picks[`q:${key}`]
    this.changed()
  }

  clearSearches(): void {
    this.data.searches = []
    this.data.history = this.data.history.filter((h) => !searchedFor(h.url))
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

  /** Adds pages that aren't bookmarked yet; returns how many were added. */
  addBookmarks(pages: { url: string; title: string }[]): number {
    let added = 0
    for (const page of pages) {
      if (!recordable(page.url) || this.isBookmarked(page.url)) continue
      this.data.bookmarks.unshift({ url: page.url, title: page.title || page.url, addedAt: this.now() })
      added++
    }
    if (added) this.changed()
    return added
  }

  /** Bookmarks the page, or removes its bookmark; returns whether it is bookmarked now. */
  toggleBookmark(url: string, title: string): boolean {
    if (this.isBookmarked(url)) {
      this.removeBookmark(url)
      return false
    }
    return this.addBookmarks([{ url, title }]) > 0
  }

  removeBookmark(url: string): void {
    this.data.bookmarks = this.data.bookmarks.filter((b) => pageKey(b.url) !== pageKey(url))
    this.changed()
  }

  // ---------------------------------------------------------------- downloads

  upsertDownload(download: BrowserDownload): void {
    const index = this.data.downloads.findIndex((d) => d.id === download.id)
    if (index >= 0) this.data.downloads[index] = download
    else {
      this.data.downloads.unshift(download)
      if (this.data.downloads.length > MAX_DOWNLOADS) this.data.downloads.length = MAX_DOWNLOADS
    }
    this.changed()
  }

  download(id: string): BrowserDownload | undefined {
    return this.data.downloads.find((d) => d.id === id)
  }

  /** Removes one finished download from the list (the file itself stays where it is). */
  removeDownload(id: string): boolean {
    const record = this.download(id)
    if (!record || record.state === 'progressing' || record.state === 'paused') return false
    this.data.downloads = this.data.downloads.filter((d) => d.id !== id)
    this.changed()
    return true
  }

  clearFinishedDownloads(): void {
    this.data.downloads = this.data.downloads.filter((d) => d.state === 'progressing')
    this.changed()
  }

  // ---------------------------------------------------------------- permissions

  /** A remembered decision for an origin and permission, if the user asked Orbis to remember it. */
  permission(origin: string, permission: string): SitePermissionDecision | undefined {
    return this.data.permissions[`${origin} ${permission}`]
  }

  rememberPermission(origin: string, permission: string, decision: SitePermissionDecision): void {
    this.data.permissions[`${origin} ${permission}`] = decision
    this.changed()
  }

  forgetPermissions(origin?: string): void {
    this.data.permissions = origin ? Object.fromEntries(Object.entries(this.data.permissions).filter(([key]) => !key.startsWith(`${origin} `))) : {}
    this.changed()
  }
}

/** The lower-cased query of a Google, Bing, DuckDuckGo or YouTube results page, or "" for other pages. */
function searchedFor(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    let q: string | null = null
    if (/^google\.[a-z.]+$/.test(host) && u.pathname === '/search') q = u.searchParams.get('q')
    else if (host === 'bing.com' && u.pathname === '/search') q = u.searchParams.get('q')
    else if (host === 'duckduckgo.com' && u.pathname === '/') q = u.searchParams.get('q')
    else if ((host === 'youtube.com' || host === 'm.youtube.com') && u.pathname === '/results') q = u.searchParams.get('search_query')
    return q ? cleanQuery(q).toLowerCase() : ''
  } catch {
    return ''
  }
}

/** A file name in `dir` that doesn't overwrite an existing download: "report.pdf", then "report (1).pdf", ... */
export function uniqueDownloadName(name: string, taken: (candidate: string) => boolean): string {
  const safe = basename(name).replace(/[<>:"/\\|?* -]/g, '_').trim() || 'download'
  const ext = extname(safe)
  const stem = ext ? safe.slice(0, -ext.length) : safe
  let candidate = safe
  for (let n = 1; taken(candidate); n++) candidate = `${stem} (${n})${ext}`
  return candidate
}
