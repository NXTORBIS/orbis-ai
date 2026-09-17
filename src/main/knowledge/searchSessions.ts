import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ftsQuery } from '../../shared/memory.ts'
import type { OrionSearchSession } from '../../shared/orionSearch.ts'
import { DEFAULT_PROFILE_ID, dataDirFor } from '../../shared/profiles.ts'
import { normalizeSearchSession, SEARCH_SESSION_FORMAT, searchableText, summarize } from '../../shared/searchSessions.ts'
import type { SavedSearchSummary } from '../../shared/searchSessions.ts'

type Row = Record<string, unknown>

/** The knowledge database for a profile. Memory, saved research and, later, Galaxy's links all live in it. */
export function knowledgeDatabase(userData: string, profileId: string): DatabaseSync {
  const dir = join(userData, dataDirFor(profileId), 'knowledge')
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, 'knowledge.db'))
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;')
  return db
}

/**
 * Orion Search sessions, saved per profile so research survives Orbis closing.
 *
 * The session is stored whole, alongside a table of its sources — one row per web address it used — so later "which of
 * my research used this site?" is a lookup rather than a scan, and full-text search over what was asked and answered.
 * It is never mixed with Orbis Chat: nothing here is read from, or written to, a conversation.
 */
export class SearchSessionStore {
  private readonly userData: string
  private profileId: string
  private db: DatabaseSync | null = null
  private readonly listeners = new Set<() => void>()

  constructor(userData: string, profileId: string = DEFAULT_PROFILE_ID) {
    this.userData = userData
    this.profileId = profileId
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
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
    const db = knowledgeDatabase(this.userData, this.profileId)
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS search_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        topic TEXT NOT NULL,
        data TEXT NOT NULL,
        turns INTEGER NOT NULL,
        sources INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS search_sessions_updated ON search_sessions (updated_at);
      CREATE TABLE IF NOT EXISTS search_sources (
        session_id TEXT NOT NULL REFERENCES search_sessions(id) ON DELETE CASCADE,
        n INTEGER NOT NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        site TEXT NOT NULL,
        turn INTEGER NOT NULL,
        PRIMARY KEY (session_id, n)
      );
      CREATE INDEX IF NOT EXISTS search_sources_url ON search_sources (url);
      CREATE VIRTUAL TABLE IF NOT EXISTS search_sessions_fts USING fts5(id UNINDEXED, body);
    `)
    db.exec('PRAGMA foreign_keys = ON;')
    db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('search_session_format', ?)`).run(String(SEARCH_SESSION_FORMAT))
    this.db = db
    return db
  }

  /** Saves a session as it now stands. Something that is not a real session with an answer is not saved. */
  save(raw: unknown): SavedSearchSummary | null {
    const session = normalizeSearchSession(raw, this.profileId)
    if (!session) return null
    const db = this.open()
    const summary = summarize(session)
    db.exec('BEGIN')
    try {
      db.prepare(
        `INSERT INTO search_sessions (id, title, topic, data, turns, sources, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, topic = excluded.topic, data = excluded.data, turns = excluded.turns, sources = excluded.sources, updated_at = excluded.updated_at`
      ).run(session.id, summary.title, session.topic, JSON.stringify(session), summary.turns, summary.sources, session.startedAt, session.updatedAt)
      db.prepare('DELETE FROM search_sources WHERE session_id = ?').run(session.id)
      const source = db.prepare('INSERT INTO search_sources (session_id, n, url, title, site, turn) VALUES (?, ?, ?, ?, ?, ?)')
      session.sources.forEach((s, i) => source.run(session.id, i + 1, s.url, s.title, s.site, s.turn))
      db.prepare('DELETE FROM search_sessions_fts WHERE id = ?').run(session.id)
      db.prepare('INSERT INTO search_sessions_fts (id, body) VALUES (?, ?)').run(session.id, searchableText(session))
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    this.changed()
    return summary
  }

  private summary(row: Row): SavedSearchSummary {
    return { id: String(row.id), title: String(row.title), topic: String(row.topic), turns: Number(row.turns), sources: Number(row.sources), startedAt: Number(row.started_at), updatedAt: Number(row.updated_at) }
  }

  /** Saved sessions, newest first, or the ones whose questions, answers or sources match a search. */
  list(query?: string, limit = 100): SavedSearchSummary[] {
    const db = this.open()
    const match = query ? ftsQuery(query) : null
    if (query && !match) return []
    const rows = match
      ? (db.prepare('SELECT s.* FROM search_sessions_fts f JOIN search_sessions s ON s.id = f.id WHERE search_sessions_fts MATCH ? ORDER BY bm25(search_sessions_fts) LIMIT ?').all(match, limit) as Row[])
      : (db.prepare('SELECT * FROM search_sessions ORDER BY updated_at DESC LIMIT ?').all(limit) as Row[])
    return rows.map((row) => this.summary(row))
  }

  get(id: string): OrionSearchSession | null {
    const row = this.open().prepare('SELECT data FROM search_sessions WHERE id = ?').get(id) as Row | undefined
    if (!row) return null
    try {
      return normalizeSearchSession(JSON.parse(String(row.data)), this.profileId)
    } catch {
      return null
    }
  }

  /** The saved session that best matches "continue my research on …". */
  find(about: string): OrionSearchSession | null {
    const best = this.list(about, 1)[0]
    return best ? this.get(best.id) : null
  }

  /** The sessions that used a web address, for Galaxy and for "where did I see this?". */
  sessionsUsing(url: string): SavedSearchSummary[] {
    return (this.open().prepare('SELECT s.* FROM search_sources x JOIN search_sessions s ON s.id = x.session_id WHERE x.url = ? GROUP BY s.id ORDER BY s.updated_at DESC').all(url) as Row[]).map((row) => this.summary(row))
  }

  /** Saved sessions with the addresses they used, newest first, for Galaxy. */
  withSources(limit = 300): (SavedSearchSummary & { sourceList: { url: string; title: string }[] })[] {
    const db = this.open()
    const sessions = this.list(undefined, limit)
    const sourcesOf = db.prepare('SELECT url, title FROM search_sources WHERE session_id = ? ORDER BY n')
    return sessions.map((s) => ({ ...s, sourceList: (sourcesOf.all(s.id) as Row[]).map((r) => ({ url: String(r.url), title: String(r.title) })) }))
  }

  remove(id: string): boolean {
    const db = this.open()
    db.prepare('DELETE FROM search_sessions_fts WHERE id = ?').run(id)
    const changes = Number(db.prepare('DELETE FROM search_sessions WHERE id = ?').run(id).changes)
    if (changes) this.changed()
    return changes > 0
  }

  clear(): number {
    const db = this.open()
    db.exec('DELETE FROM search_sessions_fts')
    const changes = Number(db.prepare('DELETE FROM search_sessions').run().changes)
    this.changed()
    return changes
  }
}
