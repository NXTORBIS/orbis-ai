import type { DatabaseSync } from 'node:sqlite'
import { buildGalaxy, checkUserLink, describeNode, selectionForOrion, viewGalaxy } from '../../shared/galaxy.ts'
import type { GalaxyGraph, GalaxySources, GalaxyView, UserLink } from '../../shared/galaxy.ts'
import { DEFAULT_PROFILE_ID } from '../../shared/profiles.ts'
import { knowledgeDatabase } from './searchSessions.ts'

type Row = Record<string, unknown>

/**
 * Galaxy for the profile in use.
 *
 * The map is built from the stores on request and kept only until any of them changes, so it is never stale and never
 * a second copy of anyone's data. The only thing Galaxy stores itself is the links a person makes, in the profile's
 * knowledge database, and they are dropped from the map the moment either end no longer exists.
 */
export class GalaxyService {
  private readonly userData: string
  private profileId: string
  private readonly collect: () => Promise<Omit<GalaxySources, 'links'>>
  private db: DatabaseSync | null = null
  private cached: GalaxyGraph | null = null
  private building: Promise<GalaxyGraph> | null = null
  private readonly listeners = new Set<() => void>()
  private readonly now: () => number
  private readonly newId: () => string

  constructor(options: { userData: string; profileId?: string; collect: () => Promise<Omit<GalaxySources, 'links'>>; now?: () => number; newId?: () => string }) {
    this.userData = options.userData
    this.profileId = options.profileId ?? DEFAULT_PROFILE_ID
    this.collect = options.collect
    this.now = options.now ?? Date.now
    this.newId = options.newId ?? (() => crypto.randomUUID())
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Something Galaxy draws from has changed: the map is rebuilt next time it is looked at, and the window is told. */
  invalidate(): void {
    this.cached = null
    for (const listener of [...this.listeners]) listener()
  }

  /**
   * Rebuilds on next look without telling anyone. Used when the map is opened: announcing it would make the window
   * reload, which would open it again, for ever.
   */
  refresh(): void {
    this.cached = null
  }

  useProfile(profileId: string): void {
    if (profileId === this.profileId) return
    this.close()
    this.profileId = profileId
    this.invalidate()
  }

  close(): void {
    this.db?.close()
    this.db = null
  }

  private open(): DatabaseSync {
    if (this.db) return this.db
    const db = knowledgeDatabase(this.userData, this.profileId)
    db.exec(`
      CREATE TABLE IF NOT EXISTS galaxy_links (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        note TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE (from_id, to_id)
      );
      CREATE INDEX IF NOT EXISTS galaxy_links_from ON galaxy_links (from_id);
      CREATE INDEX IF NOT EXISTS galaxy_links_to ON galaxy_links (to_id);
    `)
    this.db = db
    return db
  }

  links(): UserLink[] {
    return (this.open().prepare('SELECT * FROM galaxy_links ORDER BY created_at').all() as Row[]).map((row) => ({
      id: String(row.id),
      from: String(row.from_id),
      to: String(row.to_id),
      ...(row.note ? { note: String(row.note) } : {}),
      createdAt: Number(row.created_at)
    }))
  }

  /** The whole map, built once per change. */
  async graph(): Promise<GalaxyGraph> {
    if (this.cached) return this.cached
    if (!this.building) {
      const profile = this.profileId
      this.building = this.collect()
        .then((sources) => buildGalaxy({ ...sources, links: this.links() }, this.now()))
        .then((graph) => {
          // A profile switch while building means this map belongs to someone else: it is not kept.
          if (profile === this.profileId) this.cached = graph
          return graph
        })
        .finally(() => {
          this.building = null
        })
    }
    return this.building
  }

  async view(view: GalaxyView = {}): Promise<GalaxyGraph> {
    return viewGalaxy(await this.graph(), view)
  }

  async describe(id: string): Promise<ReturnType<typeof describeNode>> {
    return describeNode(await this.graph(), id)
  }

  async askAbout(ids: string[], question: string): Promise<string> {
    return selectionForOrion(await this.graph(), ids.slice(0, 40), question.slice(0, 1000))
  }

  /** Connects two things on the map, because the person said to. */
  async link(from: string, to: string, note?: string): Promise<UserLink> {
    const problem = checkUserLink(await this.graph(), from, to)
    if (problem) throw new Error(problem)
    const clean = typeof note === 'string' ? note.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
    const existing = this.links().find((l) => (l.from === from && l.to === to) || (l.from === to && l.to === from))
    if (existing) return existing
    const link: UserLink = { id: this.newId(), from, to, ...(clean ? { note: clean } : {}), createdAt: this.now() }
    this.open().prepare('INSERT INTO galaxy_links (id, from_id, to_id, note, created_at) VALUES (?, ?, ?, ?, ?)').run(link.id, from, to, clean || null, link.createdAt)
    this.invalidate()
    return link
  }

  /** Removes a link the person made. Links that come from the data are not Galaxy's to remove. */
  unlink(id: string): boolean {
    const changes = Number(this.open().prepare('DELETE FROM galaxy_links WHERE id = ?').run(id).changes)
    if (changes) this.invalidate()
    return changes > 0
  }
}
