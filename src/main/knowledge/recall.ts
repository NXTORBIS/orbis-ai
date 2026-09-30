import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  cleanPageText,
  cleanRecallSettings,
  cutoffFor,
  DEFAULT_RECALL_SETTINGS,
  hostOf,
  pageKey,
  recallQuery,
  shouldRemember,
  snippetAround
} from '../../shared/recall.ts'
import type { PageToRemember, RecallHit, RecallSettings, RecalledPage, RememberContext } from '../../shared/recall.ts'
import { DEFAULT_PROFILE_ID, dataDirFor } from '../../shared/profiles.ts'

type Row = Record<string, unknown>

/**
 * How many rows a statement touched.
 *
 * Node's SQLite reports this as a number or a bigint depending on the size, and every caller here wants a count it can
 * add up and hand to the interface. A reading index will never have enough rows for the difference to matter.
 */
const changed = (result: { changes: number | bigint }): number => Number(result.changes)

/** Bumped when the schema changes in a way a migration has to notice. */
const RECALL_FORMAT = 1

export interface RecallStats {
  pages: number
  chars: number
  oldestAt: number | null
  newestAt: number | null
  topHosts: { host: string; pages: number }[]
}

/**
 * The pages somebody has read, per profile, in a SQLite database on this computer.
 *
 * Node's own SQLite, so there is nothing to install; full-text search over the page text, so "that article about heat
 * pumps" finds the article. It sits beside the memory index in the profile's own folder and it goes nowhere else --
 * there is no network call in this file and no server behind it.
 *
 * Two honest limits, both of which the interface states rather than hiding:
 *
 * **It is not encrypted.** Full-text search needs the text, and SQLite cannot index ciphertext. Anything that can read
 * this person's files can read this. Switching the feature on is a decision somebody should make knowing that.
 *
 * **It forgets on a schedule, not on request only.** Pages fall out by age and by count, so the file cannot grow
 * without limit, and pruning runs on write rather than waiting for somebody to tidy up.
 *
 * The database is opened on first use and closed when the profile changes, so one person's reading is never open while
 * another's profile is in front.
 */
export class RecallStore {
  private readonly userData: string
  private profileId: string
  private db: DatabaseSync | null = null
  private readonly listeners = new Set<() => void>()
  private readonly now: () => number
  private readonly newId: () => string

  constructor(
    userData: string,
    profileId: string = DEFAULT_PROFILE_ID,
    options: { now?: () => number; newId?: () => string } = {}
  ) {
    this.userData = userData
    this.profileId = profileId
    this.now = options.now ?? Date.now
    this.newId = options.newId ?? ((): string => crypto.randomUUID())
  }

  get profile(): string {
    return this.profileId
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener()
  }

  useProfile(profileId: string): void {
    if (profileId === this.profileId) return
    this.close()
    this.profileId = profileId
    this.changed()
  }

  close(): void {
    this.db?.close()
    this.db = null
  }

  private open(): DatabaseSync {
    if (this.db) return this.db
    const dir = join(this.userData, dataDirFor(this.profileId), 'knowledge')
    mkdirSync(dir, { recursive: true })
    const db = new DatabaseSync(join(dir, 'recall.db'))
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    db.exec(`
      CREATE TABLE IF NOT EXISTS recall_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        host TEXT NOT NULL,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        visited_at INTEGER NOT NULL,
        chars INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS pages_visited ON pages (visited_at);
      CREATE INDEX IF NOT EXISTS pages_host ON pages (host, visited_at);
      /*
        The title is indexed alongside the body, and weighted above it at query time: somebody searching for a page they
        half remember is far more often remembering its title than a phrase from the middle of it.
      */
      CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(title, text, content='pages', content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
        INSERT INTO pages_fts(rowid, title, text) VALUES (new.rowid, new.title, new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN
        INSERT INTO pages_fts(pages_fts, rowid, title, text) VALUES ('delete', old.rowid, old.title, old.text);
      END;
      CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE OF title, text ON pages BEGIN
        INSERT INTO pages_fts(pages_fts, rowid, title, text) VALUES ('delete', old.rowid, old.title, old.text);
        INSERT INTO pages_fts(rowid, title, text) VALUES (new.rowid, new.title, new.text);
      END;
    `)
    db.prepare(`INSERT OR IGNORE INTO recall_meta (key, value) VALUES ('recall_format', ?)`).run(String(RECALL_FORMAT))
    this.db = db
    return db
  }

  // ---------------------------------------------------------------- settings

  settings(): RecallSettings {
    const row = this.open().prepare(`SELECT value FROM recall_meta WHERE key = 'recall_settings'`).get() as
      | Row
      | undefined
    try {
      return cleanRecallSettings(row ? JSON.parse(String(row.value)) : DEFAULT_RECALL_SETTINGS)
    } catch {
      return { ...DEFAULT_RECALL_SETTINGS }
    }
  }

  setSettings(next: Partial<RecallSettings>): RecallSettings {
    const merged = cleanRecallSettings({ ...this.settings(), ...next })
    this.open()
      .prepare(`INSERT INTO recall_meta (key, value) VALUES ('recall_settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify(merged))
    /**
     * Switching it off empties it.
     *
     * "Stop recording" and "keep everything you already recorded" are different requests, and somebody reaching for the
     * switch almost always means the first *and* the second. Leaving the file behind would make the switch a lie of
     * omission -- so off means gone, and the interface says so before the switch is thrown.
     */
    if (!merged.enabled) this.clear()
    // Tightening a limit applies to what is already stored, not only to what arrives next.
    else this.prune(merged)
    this.changed()
    return merged
  }

  // ---------------------------------------------------------------- keeping a page

  /**
   * Keeps a page, if it is one this person's settings allow.
   *
   * Returns what happened in words, because a recording feature that silently does nothing is exactly what people
   * distrust: every refusal here can be shown to somebody asking why a page is not in their history.
   */
  remember(page: PageToRemember, context: RememberContext = {}): { kept: boolean; reason?: string } {
    const settings = this.settings()
    const verdict = shouldRemember(page, settings, context)
    if (!verdict.keep) return { kept: false, reason: verdict.reason }

    const url = pageKey(page.url)
    const text = cleanPageText(page.text)
    const title = String(page.title ?? '').trim().slice(0, 300) || url
    const at = this.now()
    const db = this.open()

    /**
     * Read again is read again, not a second copy.
     *
     * The same address keeps one row whose text and time are replaced, so re-opening an article that has since been
     * updated stores the version actually read rather than two near-identical rows competing in the results.
     */
    db.prepare(
      `INSERT INTO pages (id, url, host, title, text, visited_at, chars)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET
         title = excluded.title,
         text = excluded.text,
         visited_at = excluded.visited_at,
         chars = excluded.chars`
    ).run(this.newId(), url, hostOf(url), title, text, at, text.length)

    this.prune(settings)
    this.changed()
    return { kept: true }
  }

  // ---------------------------------------------------------------- finding it again

  /**
   * Pages matching a search, best first.
   *
   * Ranked by SQLite's own relevance with the title weighted well above the body: somebody looking for a page they half
   * remember is usually remembering its title. Only the excerpt comes back, never the whole page -- a result list
   * carrying forty full articles would be megabytes across the boundary to draw a few lines each.
   */
  search(query: string, options: { limit?: number; host?: string; since?: number } = {}): RecallHit[] {
    const match = recallQuery(query)
    if (!match) return []
    const limit = Math.max(1, Math.min(Math.round(options.limit ?? 20), 200))
    const db = this.open()

    const conditions: string[] = ['pages_fts MATCH ?']
    const params: (string | number)[] = [match]
    if (options.host) {
      conditions.push('pages.host = ?')
      params.push(String(options.host).toLowerCase())
    }
    if (typeof options.since === 'number' && Number.isFinite(options.since)) {
      conditions.push('pages.visited_at >= ?')
      params.push(Math.round(options.since))
    }
    params.push(limit)

    const rows = db
      .prepare(
        `SELECT pages.id, pages.url, pages.host, pages.title, pages.text, pages.visited_at, pages.chars
         FROM pages_fts
         JOIN pages ON pages.rowid = pages_fts.rowid
         WHERE ${conditions.join(' AND ')}
         ORDER BY bm25(pages_fts, 10.0, 1.0), pages.visited_at DESC
         LIMIT ?`
      )
      .all(...params) as Row[]

    return rows.map((row) => ({
      id: String(row.id),
      url: String(row.url),
      host: String(row.host),
      title: String(row.title),
      visitedAt: Number(row.visited_at),
      chars: Number(row.chars),
      snippet: snippetAround(String(row.text), query)
    }))
  }

  /** The most recently read pages, for a list somebody browses rather than searches. */
  recent(limit = 50, host?: string): RecallHit[] {
    const db = this.open()
    const rows = host
      ? (db
          .prepare(
            `SELECT id, url, host, title, text, visited_at, chars FROM pages WHERE host = ? ORDER BY visited_at DESC LIMIT ?`
          )
          .all(String(host).toLowerCase(), Math.max(1, Math.min(Math.round(limit), 500))) as Row[])
      : (db
          .prepare(`SELECT id, url, host, title, text, visited_at, chars FROM pages ORDER BY visited_at DESC LIMIT ?`)
          .all(Math.max(1, Math.min(Math.round(limit), 500))) as Row[])

    return rows.map((row) => ({
      id: String(row.id),
      url: String(row.url),
      host: String(row.host),
      title: String(row.title),
      visitedAt: Number(row.visited_at),
      chars: Number(row.chars),
      snippet: snippetAround(String(row.text), '', 160)
    }))
  }

  /** One page in full, for reading back what was kept. The only way the whole text leaves this file. */
  page(id: string): RecalledPage | null {
    const row = this.open()
      .prepare(`SELECT id, url, host, title, text, visited_at, chars FROM pages WHERE id = ?`)
      .get(String(id)) as Row | undefined
    if (!row) return null
    return {
      id: String(row.id),
      url: String(row.url),
      host: String(row.host),
      title: String(row.title),
      text: String(row.text),
      visitedAt: Number(row.visited_at),
      chars: Number(row.chars)
    }
  }

  // ---------------------------------------------------------------- forgetting

  /** Forgets one page. */
  forget(id: string): boolean {
    const count = changed(this.open().prepare(`DELETE FROM pages WHERE id = ?`).run(String(id)))
    if (count > 0) this.changed()
    return count > 0
  }

  /**
   * Forgets a whole site, and optionally never records it again.
   *
   * The two together are what somebody means by "forget this site": deleting what is there while leaving it free to
   * come straight back would be a button that appears not to work.
   */
  forgetHost(host: string, alsoBlock = false): number {
    const lower = String(host ?? '').toLowerCase().replace(/^www\./, '')
    if (!lower) return 0
    const count = changed(this.open().prepare(`DELETE FROM pages WHERE host = ?`).run(lower))
    if (alsoBlock) {
      const settings = this.settings()
      if (!settings.blockedSites.includes(lower)) {
        this.setSettings({ blockedSites: [...settings.blockedSites, lower] })
      }
    }
    this.changed()
    return count
  }

  /** Forgets everything read in a window of time, for "delete the last hour". */
  forgetBetween(from: number, to: number): number {
    const count = changed(
      this.open().prepare(`DELETE FROM pages WHERE visited_at >= ? AND visited_at <= ?`).run(Math.round(from), Math.round(to))
    )
    if (count > 0) this.changed()
    return count
  }

  /** Forgets everything. Used by the switch, and by somebody who asks outright. */
  clear(): number {
    const db = this.open()
    const count = changed(db.prepare(`DELETE FROM pages`).run())
    // The index is rebuilt rather than left holding the deleted text, which would defeat the point of clearing.
    db.exec(`INSERT INTO pages_fts(pages_fts) VALUES ('rebuild'); VACUUM;`)
    this.changed()
    return count
  }

  /**
   * Drops what the settings no longer allow: too old, or too many.
   *
   * Runs on every write rather than on a timer, so the file cannot quietly overrun a limit between tidy-ups, and so
   * tightening a limit takes effect at once rather than at some later moment nobody can predict.
   */
  prune(settings: RecallSettings = this.settings()): number {
    const db = this.open()
    let dropped = 0

    const cutoff = cutoffFor(settings, this.now())
    if (cutoff !== null) {
      dropped += changed(db.prepare(`DELETE FROM pages WHERE visited_at < ?`).run(cutoff))
    }

    const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM pages`).get() as Row).n)
    if (total > settings.maxPages) {
      dropped += changed(
        db
          .prepare(
            `DELETE FROM pages WHERE id IN (
               SELECT id FROM pages ORDER BY visited_at ASC LIMIT ?
             )`
          )
          .run(total - settings.maxPages)
      )
    }
    return dropped
  }

  // ---------------------------------------------------------------- what it is costing

  /** What is stored, for telling somebody plainly what this feature is holding of theirs. */
  stats(): RecallStats {
    const db = this.open()
    const totals = db.prepare(`SELECT COUNT(*) AS pages, COALESCE(SUM(chars), 0) AS chars, MIN(visited_at) AS oldest, MAX(visited_at) AS newest FROM pages`).get() as Row
    const hosts = db
      .prepare(`SELECT host, COUNT(*) AS pages FROM pages GROUP BY host ORDER BY pages DESC LIMIT 10`)
      .all() as Row[]
    return {
      pages: Number(totals.pages ?? 0),
      chars: Number(totals.chars ?? 0),
      oldestAt: totals.oldest === null || totals.oldest === undefined ? null : Number(totals.oldest),
      newestAt: totals.newest === null || totals.newest === undefined ? null : Number(totals.newest),
      topHosts: hosts.map((row) => ({ host: String(row.host), pages: Number(row.pages) }))
    }
  }

  /** Whether a page is already kept, so a capture pass can skip reading a tab it has already read. */
  has(url: string): boolean {
    const row = this.open().prepare(`SELECT 1 AS one FROM pages WHERE url = ?`).get(pageKey(url)) as Row | undefined
    return row !== undefined
  }

  /** When a page was last read, so a capture pass can re-read one that is old rather than every one it sees. */
  visitedAt(url: string): number | null {
    const row = this.open().prepare(`SELECT visited_at FROM pages WHERE url = ?`).get(pageKey(url)) as Row | undefined
    return row ? Number(row.visited_at) : null
  }
}
