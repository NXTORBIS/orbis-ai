import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  checkMemory,
  DEFAULT_MEMORY_SETTINGS,
  ftsQuery,
  guessCategory,
  MEMORY_CATEGORIES,
  MEMORY_FORMAT,
  MEMORY_MAX_ACTIVE,
  MEMORY_MAX_PINNED_IN_PROMPT,
  MEMORY_MAX_RELEVANT_IN_PROMPT,
  normalizeMemorySettings
} from '../../shared/memory.ts'
import type { MemoryCategory, MemoryEntry, MemorySettings } from '../../shared/memory.ts'
import { DEFAULT_PROFILE_ID, dataDirFor } from '../../shared/profiles.ts'

type Row = Record<string, unknown>

export class MemoryFull extends Error {}
export class MemoryRefused extends Error {}

/**
 * Memory, per profile, in a SQLite database on this computer (Node's own SQLite: nothing to install, nothing sent
 * anywhere). Full-text search finds the entries that matter for a message, so Orion is given a handful, not the store.
 *
 * The database is opened only when memory is first used, and closed when the profile changes. Its schema carries a
 * version, so later changes can migrate rather than break it.
 */
export class MemoryStore {
  private readonly userData: string
  private profileId: string
  private db: DatabaseSync | null = null
  private readonly listeners = new Set<() => void>()
  private readonly now: () => number
  private readonly newId: () => string

  constructor(userData: string, profileId: string = DEFAULT_PROFILE_ID, options: { now?: () => number; newId?: () => string } = {}) {
    this.userData = userData
    this.profileId = profileId
    this.now = options.now ?? Date.now
    this.newId = options.newId ?? (() => crypto.randomUUID())
  }

  get profile(): string {
    return this.profileId
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
    const dir = join(this.userData, dataDirFor(this.profileId), 'knowledge')
    mkdirSync(dir, { recursive: true })
    const db = new DatabaseSync(join(dir, 'knowledge.db'))
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        category TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        origin TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_used_at INTEGER,
        project_id TEXT
      );
      CREATE INDEX IF NOT EXISTS memories_active ON memories (archived, pinned, updated_at);
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(text, content='memories', content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF text ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
        INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
    `)
    /*
     * Which project a memory belongs to, added after the table already existed.
     *
     * `CREATE TABLE IF NOT EXISTS` leaves an older file exactly as it is, so the column has to be added separately.
     * Adding one that is already there is an error rather than a no-op, which is why this is wrapped: the failure
     * means the column exists, which is the state wanted.
     */
    try {
      db.exec('ALTER TABLE memories ADD COLUMN project_id TEXT')
    } catch {
      // Already there.
    }
    db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('memory_format', ?)`).run(String(MEMORY_FORMAT))
    this.db = db
    return db
  }

  // ---------------------------------------------------------------- settings

  settings(): MemorySettings {
    const row = this.open().prepare(`SELECT value FROM meta WHERE key = 'memory_settings'`).get() as Row | undefined
    try {
      return normalizeMemorySettings(row ? JSON.parse(String(row.value)) : DEFAULT_MEMORY_SETTINGS)
    } catch {
      return { ...DEFAULT_MEMORY_SETTINGS }
    }
  }

  setSettings(next: Partial<MemorySettings>): MemorySettings {
    const merged = normalizeMemorySettings({ ...this.settings(), ...next })
    this.open().prepare(`INSERT INTO meta (key, value) VALUES ('memory_settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(merged))
    this.changed()
    return merged
  }

  // ---------------------------------------------------------------- the entries

  private entry(row: Row): MemoryEntry {
    return {
      id: String(row.id),
      text: String(row.text),
      category: MEMORY_CATEGORIES.includes(row.category as MemoryCategory) ? (row.category as MemoryCategory) : 'general',
      pinned: Number(row.pinned) === 1,
      archived: Number(row.archived) === 1,
      origin: (['settings', 'chat', 'suggestion', 'import'].includes(String(row.origin)) ? row.origin : 'settings') as MemoryEntry['origin'],
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      ...(row.last_used_at === null || row.last_used_at === undefined ? {} : { lastUsedAt: Number(row.last_used_at) }),
      ...(row.project_id ? { projectId: String(row.project_id) } : {})
    }
  }

  /** Everything, or what matches a search, newest first; archived entries only when asked for. */
  list(options: { query?: string; includeArchived?: boolean; category?: MemoryCategory } = {}): MemoryEntry[] {
    const db = this.open()
    const where: string[] = []
    const args: (string | number)[] = []
    if (!options.includeArchived) where.push('m.archived = 0')
    if (options.category) {
      where.push('m.category = ?')
      args.push(options.category)
    }
    const match = options.query ? ftsQuery(options.query) : null
    if (options.query && !match) return []
    const sql = match
      ? `SELECT m.* FROM memories_fts f JOIN memories m ON m.rowid = f.rowid WHERE memories_fts MATCH ? ${where.length ? `AND ${where.join(' AND ')}` : ''} ORDER BY bm25(memories_fts) LIMIT 500`
      : `SELECT m.* FROM memories m ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY m.pinned DESC, m.updated_at DESC LIMIT 1000`
    return (db.prepare(sql).all(...(match ? [match, ...args] : args)) as Row[]).map((row) => this.entry(row))
  }

  get(id: string): MemoryEntry | null {
    const row = this.open().prepare('SELECT * FROM memories WHERE id = ?').get(id) as Row | undefined
    return row ? this.entry(row) : null
  }

  private activeCount(): number {
    return Number((this.open().prepare('SELECT COUNT(*) AS n FROM memories WHERE archived = 0').get() as Row).n)
  }

  /**
   * Keeps something, because the person asked. Refused with a reason when it is secret, too long, a repeat, or when
   * memory is full — Orbis never makes room by forgetting something on its own.
   */
  add(text: unknown, options: { category?: MemoryCategory; pinned?: boolean; origin?: MemoryEntry['origin']; projectId?: string } = {}): MemoryEntry {
    if (!this.settings().enabled) throw new MemoryRefused('Memory is switched off in Settings.')
    const checked = checkMemory(text)
    if (!checked.ok) throw new MemoryRefused(checked.why)
    const db = this.open()
    const same = db.prepare('SELECT * FROM memories WHERE lower(text) = lower(?) AND archived = 0').get(checked.text) as Row | undefined
    if (same) return this.entry(same)
    if (this.activeCount() >= MEMORY_MAX_ACTIVE) {
      throw new MemoryFull(`Memory is full (${MEMORY_MAX_ACTIVE} entries). Archive or delete some in Settings → Memory to make room.`)
    }
    const now = this.now()
    const id = this.newId()
    const category = options.category && MEMORY_CATEGORIES.includes(options.category) ? options.category : guessCategory(checked.text)
    db.prepare('INSERT INTO memories (id, text, category, pinned, archived, origin, created_at, updated_at, project_id) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)').run(
      id,
      checked.text,
      category,
      options.pinned ? 1 : 0,
      options.origin ?? 'settings',
      now,
      now,
      options.projectId ?? null
    )
    this.changed()
    return this.get(id)!
  }

  update(id: string, patch: { text?: unknown; category?: MemoryCategory; pinned?: boolean; archived?: boolean }): MemoryEntry {
    const current = this.get(id)
    if (!current) throw new MemoryRefused('That memory no longer exists.')
    let text = current.text
    if (patch.text !== undefined) {
      const checked = checkMemory(patch.text)
      if (!checked.ok) throw new MemoryRefused(checked.why)
      text = checked.text
    }
    if (patch.archived === false && current.archived && this.activeCount() >= MEMORY_MAX_ACTIVE) {
      throw new MemoryFull(`Memory is full (${MEMORY_MAX_ACTIVE} entries). Delete or archive another one first.`)
    }
    const category = patch.category && MEMORY_CATEGORIES.includes(patch.category) ? patch.category : current.category
    this.open()
      .prepare('UPDATE memories SET text = ?, category = ?, pinned = ?, archived = ?, updated_at = ? WHERE id = ?')
      .run(text, category, (patch.pinned ?? current.pinned) ? 1 : 0, (patch.archived ?? current.archived) ? 1 : 0, this.now(), id)
    this.changed()
    return this.get(id)!
  }

  remove(id: string): boolean {
    const changes = Number(this.open().prepare('DELETE FROM memories WHERE id = ?').run(id).changes)
    if (changes) this.changed()
    return changes > 0
  }

  clear(): number {
    const changes = Number(this.open().prepare('DELETE FROM memories').run().changes)
    this.changed()
    return changes
  }

  /**
   * Forgets what matches something said in chat. Only entries that match every word are removed, so "forget that I
   * live in Chennai" does not also forget everything else mentioning Chennai.
   */
  forget(text: string): MemoryEntry[] {
    const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !['that', 'about', 'the', 'and'].includes(w))
    if (!words.length) return []
    const candidates = this.list({ query: text, includeArchived: true })
    const gone = candidates.filter((entry) => words.every((word) => entry.text.toLowerCase().includes(word)))
    for (const entry of gone) this.open().prepare('DELETE FROM memories WHERE id = ?').run(entry.id)
    if (gone.length) this.changed()
    return gone
  }

  /**
   * What Orion should be given for a message: pinned entries, then the few most relevant, and never archived ones.
   * Each is stamped as used, which is how the person can see what memory actually does.
   */
  relevant(message: string, projectId?: string): MemoryEntry[] {
    const settings = this.settings()
    if (!settings.enabled || !settings.useInChat) return []
    const db = this.open()
    /*
     * Which memories this message may see.
     *
     * A memory with no project is the person, and travels everywhere. A memory kept inside a project is about that
     * work, and is only given to Orion while answering inside it -- so setting up one project to work a particular
     * way cannot quietly change the answers in every other conversation. Outside every project, only the memories
     * that belong to no project are used.
     */
    const scope = projectId ? '(m.project_id IS NULL OR m.project_id = ?)' : 'm.project_id IS NULL'
    const scopeArgs: string[] = projectId ? [projectId] : []
    const pinned = (
      db.prepare(`SELECT m.* FROM memories m WHERE m.archived = 0 AND m.pinned = 1 AND ${scope} ORDER BY m.updated_at DESC LIMIT ?`).all(...scopeArgs, MEMORY_MAX_PINNED_IN_PROMPT) as Row[]
    ).map((row) => this.entry(row))
    const match = ftsQuery(message)
    const found = match
      ? (
          db
            .prepare(
              `SELECT m.* FROM memories_fts f JOIN memories m ON m.rowid = f.rowid WHERE memories_fts MATCH ? AND m.archived = 0 AND m.pinned = 0 AND ${scope} ORDER BY bm25(memories_fts) LIMIT ?`
            )
            .all(match, ...scopeArgs, MEMORY_MAX_RELEVANT_IN_PROMPT) as Row[]
        ).map((row) => this.entry(row))
      : []
    const used = [...pinned, ...found]
    if (used.length) {
      const stamp = db.prepare('UPDATE memories SET last_used_at = ? WHERE id = ?')
      const now = this.now()
      for (const entry of used) stamp.run(now, entry.id)
    }
    return used
  }
}
