import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AppDatabase } from './Database';
import { isWithin } from '../fs/paths';
import { ORPHAN_PREFIX } from './migrations';
import { makeError } from '../../shared/errors';

/**
 * Local catalogue: application-owned metadata ABOUT files and native content.
 * It never stores file contents and never deletes files. Each catalogue item
 * has a stable id independent of its path; paths are revalidated against the
 * file's device/inode so a stale entry never silently points to a different file.
 */

export interface CatalogItem {
  id: string;
  path: string;
  kind: string;
  description: string | null;
  rating: number | null;
  source: string;
  missing: boolean;
  /** Present after revalidation. 'replaced' = a different file now occupies the path. */
  status?: 'ok' | 'missing' | 'replaced';
}

export interface Tag { id: string; name: string; color: string | null; count: number }
export interface Collection { id: string; name: string; count: number; createdMs: number }
export interface Pin { path: string; label: string | null; position: number }
export interface Recent { path: string; kind: 'file' | 'directory'; lastMs: number; count: number }
export interface SavedSearch { id: string; name: string; query: string; scope: string[]; createdMs: number }
export interface Workspace { id: string; name: string; state: unknown; updatedMs: number }
export interface SmartFolder { id: string; name: string; icon: string | null; color: string | null; query: SmartFolderQuery; createdMs: number; updatedMs: number }
export interface SmartFolderQuery { tags?: string[]; labels?: string[]; extensions?: string[]; minSize?: number; maxSize?: number; modifiedAfter?: number; modifiedBefore?: number }
export interface ClipPin { id: string; mode: 'copy' | 'cut'; paths: string[]; label: string | null; pinnedMs: number }
export interface DownloadEntry {
  id: string; path: string; url: string | null; referrer: string | null; mime: string | null;
  state: string; browser: string; startedMs: number | null; finishedMs: number | null; source: string;
  exists?: boolean; size?: number; modifiedMs?: number;
}
export interface Project { id: string; name: string; root: string; kind: string; markers: string[]; createdMs: number; itemCount: number; rootExists?: boolean }
export interface StorageSnapshot { id: string; root: string; ms: number; bytes: number; files: number; directories: number; complete: boolean; byCategory: Array<{ category: string; bytes: number; files: number }> }

/** Lookups the search engine uses for catalogue-based filters; built once per search. */
export interface CatalogLookups {
  note(path: string): string | undefined;
  rating(path: string): number | undefined;
  sources(path: string): Set<string>;
  inCollection(name: string, path: string): boolean;
  inProject(name: string, path: string): boolean;
}

export interface GeneratedEntry {
  id: string; path: string; generator: string; chatId: string | null; prompt: string | null; createdMs: number;
  exists?: boolean; size?: number;
}

const now = () => Date.now();
const uuid = () => crypto.randomUUID();

export class Catalog extends EventEmitter {
  constructor(private readonly db: AppDatabase) {
    super();
  }

  private changed(what: string): void {
    this.emit('changed', what);
  }

  // ---------- pins ----------
  pins(): Pin[] {
    return this.db.all<Pin>('SELECT path, label, position FROM pins ORDER BY position');
  }

  pin(p: string, label?: string): void {
    const max = this.db.get<{ m: number | null }>('SELECT MAX(position) AS m FROM pins')?.m ?? -1;
    this.db.run('INSERT OR IGNORE INTO pins(path, label, position, created_ms) VALUES(?, ?, ?, ?)', [p, label ?? null, max + 1, now()]);
    this.changed('pins');
  }

  unpin(p: string): void {
    this.db.run('DELETE FROM pins WHERE path = ?', [p]);
    this.changed('pins');
  }

  reorderPins(paths: string[]): void {
    this.db.tx(() => paths.forEach((p, i) => this.db.run('UPDATE pins SET position = ? WHERE path = ?', [i, p])));
    this.changed('pins');
  }

  // ---------- recents ----------
  recordRecent(p: string, kind: 'file' | 'directory'): void {
    this.db.run(
      'INSERT INTO recents(path, kind, last_ms, count) VALUES(?, ?, ?, 1) ON CONFLICT(path) DO UPDATE SET last_ms = excluded.last_ms, count = count + 1, kind = excluded.kind',
      [p, kind, now()],
    );
    // Recents are a bounded history by design; keep the most recent 2000.
    this.db.run('DELETE FROM recents WHERE path NOT IN (SELECT path FROM recents ORDER BY last_ms DESC LIMIT 2000)');
    this.changed('recents');
  }

  async recents(limit = 50): Promise<Array<Recent & { exists: boolean }>> {
    const rows = this.db.all<{ path: string; kind: 'file' | 'directory'; last_ms: number; count: number }>(
      'SELECT path, kind, last_ms, count FROM recents ORDER BY last_ms DESC LIMIT ?',
      [limit],
    );
    return Promise.all(
      rows.map(async (r) => ({ path: r.path, kind: r.kind, lastMs: r.last_ms, count: r.count, exists: await fsp.lstat(r.path).then(() => true, () => false) })),
    );
  }

  clearRecents(): void {
    this.db.run('DELETE FROM recents');
    this.changed('recents');
  }

  // ---------- items (stable references) ----------
  /**
   * Get or create the catalogue item for the file currently at `p`.
   * If an existing item at that path no longer matches the file's identity,
   * it is detached (orphaned) so its tags/notes are not grafted onto a different file.
   */
  async ensureItem(p: string, source = 'filesystem'): Promise<CatalogItem> {
    let st: import('node:fs').Stats;
    try {
      st = await fsp.lstat(p);
    } catch {
      throw makeError('not_found', 'catalog.ensureItem', { target: p });
    }
    const kind = st.isDirectory() ? 'directory' : st.isSymbolicLink() ? 'symlink' : 'file';
    const birth = st.birthtimeMs > 0 ? st.birthtimeMs : null;
    const existing = this.db.get<IdentityRow>('SELECT id, dev, ino, birth_ms, missing FROM items WHERE path = ?', [p]);
    if (existing) {
      if (existing.missing || !identityMatches(existing, st)) {
        this.orphan(existing.id, p);
      } else {
        this.db.run('UPDATE items SET size = ?, mtime_ms = ?, kind = ?, birth_ms = COALESCE(birth_ms, ?), updated_ms = ? WHERE id = ?', [st.size, st.mtimeMs, kind, birth, now(), existing.id]);
        return this.item(existing.id)!;
      }
    }
    const id = uuid();
    this.db.run(
      'INSERT INTO items(id, path, kind, dev, ino, birth_ms, size, mtime_ms, source, created_ms, updated_ms) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, p, kind, st.dev, st.ino, birth, st.size, st.mtimeMs, source, now(), now()],
    );
    this.changed('items');
    return this.item(id)!;
  }

  /** Detach an item from a path it no longer describes. Its metadata is kept and shown as missing. */
  private orphan(id: string, lastPath: string): void {
    this.db.run('UPDATE items SET path = ?, last_path = ?, missing = 1, updated_ms = ? WHERE id = ?', [`${ORPHAN_PREFIX}${id}`, lastPath, now(), id]);
  }

  item(id: string): CatalogItem | undefined {
    const r = this.db.get<{ id: string; path: string; last_path: string | null; kind: string; description: string | null; rating: number | null; source: string; missing: number }>(
      'SELECT id, path, last_path, kind, description, rating, source, missing FROM items WHERE id = ?',
      [id],
    );
    if (!r) return undefined;
    const orphaned = r.path.startsWith(ORPHAN_PREFIX);
    return {
      id: r.id, kind: r.kind, description: r.description, rating: r.rating, source: r.source,
      path: orphaned ? (r.last_path ?? '') : r.path,
      missing: !!r.missing || orphaned,
      ...(orphaned ? { status: 'missing' as const } : {}),
    };
  }

  itemByPath(p: string): CatalogItem | undefined {
    const r = this.db.get<{ id: string }>('SELECT id FROM items WHERE path = ?', [p]);
    return r ? this.item(r.id) : undefined;
  }

  /**
   * Check an item's path still refers to the same file (device, inode and birth
   * time). A reference that went missing stays missing even if a file later
   * appears at the same path; only a verified move (onMoved) or an explicit
   * re-add re-links it.
   */
  async revalidate(item: CatalogItem): Promise<CatalogItem> {
    const row = this.db.get<IdentityRow & { path: string }>('SELECT id, path, dev, ino, birth_ms, missing FROM items WHERE id = ?', [item.id]);
    if (!row || row.path.startsWith(ORPHAN_PREFIX)) return { ...item, missing: true, status: 'missing' };
    let status: CatalogItem['status'];
    try {
      const st = await fsp.lstat(row.path);
      status = row.missing || !identityMatches(row, st) ? 'replaced' : 'ok';
    } catch {
      status = 'missing';
    }
    const missing = status !== 'ok';
    if (missing && !row.missing) this.db.run('UPDATE items SET missing = 1, updated_ms = ? WHERE id = ?', [now(), item.id]);
    return { ...item, missing, status };
  }

  /** Called by the operation engine after a verified rename/move so references follow the file. */
  onMoved(from: string, to: string): void {
    const rows = this.db.all<{ id: string; path: string }>('SELECT id, path FROM items');
    const affected = rows.filter((r) => r.path === from || isWithin(from, r.path));
    if (!affected.length) {
      this.renameInTables(from, to);
      return;
    }
    this.db.tx(() => {
      for (const r of affected) {
        const next = r.path === from ? to : path.join(to, path.relative(from, r.path));
        // If a stale item already holds the target path, it described a file that no longer exists there.
        this.db.run('DELETE FROM items WHERE path = ? AND id != ?', [next, r.id]);
        this.db.run('UPDATE items SET path = ?, missing = 0, updated_ms = ? WHERE id = ?', [next, now(), r.id]);
      }
    });
    this.renameInTables(from, to);
    this.changed('items');
  }

  private renameInTables(from: string, to: string): void {
    for (const table of ['pins', 'recents'] as const) {
      const rows = this.db.all<{ path: string }>(`SELECT path FROM ${table}`);
      for (const r of rows) {
        if (r.path === from || isWithin(from, r.path)) {
          const next = r.path === from ? to : path.join(to, path.relative(from, r.path));
          this.db.run(`UPDATE OR REPLACE ${table} SET path = ? WHERE path = ?`, [next, r.path]);
        }
      }
    }
  }

  /** Called after a verified delete/trash: references are marked missing, never removed silently. */
  onRemoved(p: string): void {
    const rows = this.db.all<{ id: string; path: string }>('SELECT id, path FROM items');
    const ids = rows.filter((r) => r.path === p || isWithin(p, r.path)).map((r) => r.id);
    if (ids.length) {
      this.db.tx(() => ids.forEach((id) => this.db.run('UPDATE items SET missing = 1, updated_ms = ? WHERE id = ?', [now(), id])));
      this.changed('items');
    }
  }

  async itemMeta(p: string): Promise<{ item?: CatalogItem; tags: Tag[]; collections: Collection[] }> {
    const item = this.itemByPath(p);
    if (!item) return { tags: [], collections: [] };
    const tags = this.db.all<Tag>(
      'SELECT t.id, t.name, t.color, 0 AS count FROM tags t JOIN item_tags it ON it.tag_id = t.id WHERE it.item_id = ? ORDER BY t.name',
      [item.id],
    );
    const collections = this.db.all<{ id: string; name: string; created_ms: number }>(
      'SELECT c.id, c.name, c.created_ms FROM collections c JOIN collection_items ci ON ci.collection_id = c.id WHERE ci.item_id = ?',
      [item.id],
    ).map((c) => ({ id: c.id, name: c.name, createdMs: c.created_ms, count: 0 }));
    return { item: await this.revalidate(item), tags, collections };
  }

  async setItemMeta(p: string, meta: { description?: string | null; rating?: number | null }): Promise<CatalogItem> {
    const item = await this.ensureItem(p);
    if (meta.description !== undefined) this.db.run('UPDATE items SET description = ?, updated_ms = ? WHERE id = ?', [meta.description, now(), item.id]);
    if (meta.rating !== undefined) this.db.run('UPDATE items SET rating = ?, updated_ms = ? WHERE id = ?', [meta.rating, now(), item.id]);
    this.changed('items');
    return this.item(item.id)!;
  }

  // ---------- tags ----------
  tags(): Tag[] {
    return this.db.all<Tag>(
      'SELECT t.id, t.name, t.color, COUNT(it.item_id) AS count FROM tags t LEFT JOIN item_tags it ON it.tag_id = t.id GROUP BY t.id ORDER BY t.name COLLATE NOCASE',
    );
  }

  createTag(name: string, color?: string): Tag {
    const clean = name.trim();
    if (!clean) throw makeError('validation', 'catalog.createTag', { message: 'Tag name cannot be empty.' });
    if (this.db.get('SELECT id FROM tags WHERE name = ? COLLATE NOCASE', [clean])) {
      throw makeError('already_exists', 'catalog.createTag', { message: `A tag named "${clean}" already exists.` });
    }
    const id = uuid();
    this.db.run('INSERT INTO tags(id, name, color, created_ms) VALUES(?, ?, ?, ?)', [id, clean, color ?? null, now()]);
    this.changed('tags');
    return { id, name: clean, color: color ?? null, count: 0 };
  }

  renameTag(id: string, name: string): void {
    const clean = name.trim();
    const clash = this.db.get<{ id: string }>('SELECT id FROM tags WHERE name = ? COLLATE NOCASE', [clean]);
    if (clash && clash.id !== id) throw makeError('already_exists', 'catalog.renameTag', { message: `A tag named "${clean}" already exists.` });
    this.db.run('UPDATE tags SET name = ? WHERE id = ?', [clean, id]);
    this.changed('tags');
  }

  /** Deletes the tag and its assignments only. Files are untouched. */
  deleteTag(id: string): void {
    this.db.run('DELETE FROM tags WHERE id = ?', [id]);
    this.changed('tags');
  }

  async tagItems(tagId: string, paths: string[]): Promise<{ tagged: number; failed: string[] }> {
    if (!this.db.get('SELECT id FROM tags WHERE id = ?', [tagId])) throw makeError('not_found', 'catalog.tagItems', { message: 'Tag not found.' });
    const failed: string[] = [];
    let tagged = 0;
    for (const p of paths) {
      try {
        const item = await this.ensureItem(p);
        this.db.run('INSERT OR IGNORE INTO item_tags(item_id, tag_id) VALUES(?, ?)', [item.id, tagId]);
        tagged++;
      } catch {
        failed.push(p);
      }
    }
    this.changed('tags');
    return { tagged, failed };
  }

  untagItems(tagId: string, paths: string[]): number {
    let n = 0;
    this.db.tx(() => {
      for (const p of paths) {
        const item = this.db.get<{ id: string }>('SELECT id FROM items WHERE path = ?', [p]);
        if (item) {
          this.db.run('DELETE FROM item_tags WHERE item_id = ? AND tag_id = ?', [item.id, tagId]);
          n += this.db.changes();
        }
      }
    });
    this.changed('tags');
    return n;
  }

  tagsFor(paths: string[]): Record<string, Array<{ id: string; name: string; color: string | null }>> {
    const out: Record<string, Array<{ id: string; name: string; color: string | null }>> = {};
    if (!paths.length) return out;
    const rows = this.db.all<{ path: string; id: string; name: string; color: string | null }>(
      'SELECT i.path, t.id, t.name, t.color FROM items i JOIN item_tags it ON it.item_id = i.id JOIN tags t ON t.id = it.tag_id',
    );
    const wanted = new Set(paths);
    for (const r of rows) if (wanted.has(r.path)) (out[r.path] ??= []).push({ id: r.id, name: r.name, color: r.color });
    return out;
  }

  async itemsWithTag(tagId: string): Promise<CatalogItem[]> {
    const rows = this.db.all<{ id: string }>('SELECT item_id AS id FROM item_tags WHERE tag_id = ?', [tagId]);
    return Promise.all(rows.map((r) => this.revalidate(this.item(r.id)!)));
  }

  /** Paths for a tag name (used by the search engine's tag: filter). */
  pathsWithTagName(name: string): Set<string> {
    const rows = this.db.all<{ path: string }>(
      'SELECT i.path FROM items i JOIN item_tags it ON it.item_id = i.id JOIN tags t ON t.id = it.tag_id WHERE t.name = ? COLLATE NOCASE',
      [name],
    );
    return new Set(rows.map((r) => r.path));
  }

  // ---------- collections ----------
  collections(): Collection[] {
    return this.db
      .all<{ id: string; name: string; created_ms: number; count: number }>(
        'SELECT c.id, c.name, c.created_ms, COUNT(ci.id) AS count FROM collections c LEFT JOIN collection_items ci ON ci.collection_id = c.id GROUP BY c.id ORDER BY c.name COLLATE NOCASE',
      )
      .map((c) => ({ id: c.id, name: c.name, createdMs: c.created_ms, count: c.count }));
  }

  createCollection(name: string): Collection {
    const id = uuid();
    const clean = name.trim();
    if (!clean) throw makeError('validation', 'catalog.createCollection', { message: 'Collection name cannot be empty.' });
    this.db.run('INSERT INTO collections(id, name, created_ms) VALUES(?, ?, ?)', [id, clean, now()]);
    this.changed('collections');
    return { id, name: clean, count: 0, createdMs: now() };
  }

  renameCollection(id: string, name: string): void {
    this.db.run('UPDATE collections SET name = ? WHERE id = ?', [name.trim(), id]);
    this.changed('collections');
  }

  /** Removes the collection and its references. The referenced files are untouched. */
  deleteCollection(id: string): void {
    this.db.run('DELETE FROM collections WHERE id = ?', [id]);
    this.changed('collections');
  }

  async addToCollection(id: string, paths: string[]): Promise<{ added: number; failed: string[] }> {
    if (!this.db.get('SELECT id FROM collections WHERE id = ?', [id])) throw makeError('not_found', 'catalog.addToCollection', { message: 'Collection not found.' });
    let added = 0;
    const failed: string[] = [];
    for (const p of paths) {
      try {
        const item = await this.ensureItem(p);
        this.db.run('INSERT OR IGNORE INTO collection_items(id, collection_id, item_id, added_ms) VALUES(?, ?, ?, ?)', [uuid(), id, item.id, now()]);
        added += this.db.changes();
      } catch {
        failed.push(p);
      }
    }
    this.changed('collections');
    return { added, failed };
  }

  /** Remove references from a collection. Never deletes the underlying files. */
  removeFromCollection(id: string, itemIds: string[]): number {
    let n = 0;
    this.db.tx(() => {
      for (const itemId of itemIds) {
        this.db.run('DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?', [id, itemId]);
        n += this.db.changes();
      }
    });
    this.changed('collections');
    return n;
  }

  async collectionItems(id: string): Promise<CatalogItem[]> {
    const rows = this.db.all<{ item_id: string }>('SELECT item_id FROM collection_items WHERE collection_id = ? ORDER BY added_ms', [id]);
    return Promise.all(rows.map((r) => this.revalidate(this.item(r.item_id)!)));
  }

  // ---------- saved searches ----------
  savedSearches(): SavedSearch[] {
    return this.db
      .all<{ id: string; name: string; query: string; scope: string; created_ms: number }>('SELECT * FROM saved_searches ORDER BY name COLLATE NOCASE')
      .map((s) => ({ id: s.id, name: s.name, query: s.query, scope: safeJson<string[]>(s.scope, []), createdMs: s.created_ms }));
  }

  saveSearch(name: string, query: string, scope: string[]): SavedSearch {
    const id = uuid();
    this.db.run('INSERT INTO saved_searches(id, name, query, scope, created_ms) VALUES(?, ?, ?, ?, ?)', [id, name.trim(), query, JSON.stringify(scope), now()]);
    this.changed('savedSearches');
    return { id, name, query, scope, createdMs: now() };
  }

  deleteSavedSearch(id: string): void {
    this.db.run('DELETE FROM saved_searches WHERE id = ?', [id]);
    this.changed('savedSearches');
  }

  // ---------- key/value (sidebar, session) ----------
  getKv<T>(key: string, fallback: T): T {
    const r = this.db.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
    return r ? safeJson<T>(r.value, fallback) : fallback;
  }

  setKv(key: string, value: unknown): void {
    const json = JSON.stringify(value ?? null);
    if (json.length > 8 * 1024 * 1024) throw makeError('validation', 'catalog.setKv', { message: 'Value too large.' });
    this.db.run('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, json]);
  }

  // ---------- workspaces ----------
  workspaces(): Workspace[] {
    return this.db
      .all<{ id: string; name: string; state: string; updated_ms: number }>('SELECT * FROM workspaces ORDER BY name COLLATE NOCASE')
      .map((w) => ({ id: w.id, name: w.name, state: safeJson(w.state, null), updatedMs: w.updated_ms }));
  }

  saveWorkspace(name: string, state: unknown): Workspace {
    const existing = this.db.get<{ id: string }>('SELECT id FROM workspaces WHERE name = ?', [name.trim()]);
    const id = existing?.id ?? uuid();
    this.db.run('INSERT INTO workspaces(id, name, state, updated_ms) VALUES(?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_ms = excluded.updated_ms', [
      id, name.trim(), JSON.stringify(state), now(),
    ]);
    this.changed('workspaces');
    return { id, name, state, updatedMs: now() };
  }

  deleteWorkspace(id: string): void {
    this.db.run('DELETE FROM workspaces WHERE id = ?', [id]);
    this.changed('workspaces');
  }

  loadWorkspace(id: string): Workspace | undefined {
    const row = this.db.get<{ id: string; name: string; state: string; updated_ms: number }>('SELECT * FROM workspaces WHERE id = ?', [id]);
    return row ? { id: row.id, name: row.name, state: safeJson(row.state, null), updatedMs: row.updated_ms } : undefined;
  }

  // ---------- smart folders ----------
  smartFolders(): SmartFolder[] {
    return this.db
      .all<{ id: string; name: string; icon: string | null; color: string | null; query: string; created_ms: number; updated_ms: number }>('SELECT * FROM smart_folders ORDER BY name COLLATE NOCASE')
      .map((r) => ({ id: r.id, name: r.name, icon: r.icon, color: r.color, query: safeJson(r.query, {}), createdMs: r.created_ms, updatedMs: r.updated_ms }));
  }

  createSmartFolder(name: string, query: SmartFolderQuery, icon?: string, color?: string): SmartFolder {
    const id = uuid();
    const ms = now();
    this.db.run('INSERT INTO smart_folders(id, name, icon, color, query, created_ms, updated_ms) VALUES(?, ?, ?, ?, ?, ?, ?)', [
      id, name.trim(), icon ?? null, color ?? null, JSON.stringify(query), ms, ms,
    ]);
    this.changed('smartFolders');
    return { id, name: name.trim(), icon: icon ?? null, color: color ?? null, query, createdMs: ms, updatedMs: ms };
  }

  updateSmartFolder(id: string, updates: { name?: string; query?: SmartFolderQuery; icon?: string; color?: string }): void {
    const parts: string[] = [];
    const vals: Array<string | number | null> = [];
    if (updates.name !== undefined) { parts.push('name = ?'); vals.push(updates.name.trim()); }
    if (updates.query !== undefined) { parts.push('query = ?'); vals.push(JSON.stringify(updates.query)); }
    if (updates.icon !== undefined) { parts.push('icon = ?'); vals.push(updates.icon); }
    if (updates.color !== undefined) { parts.push('color = ?'); vals.push(updates.color); }
    if (!parts.length) return;
    parts.push('updated_ms = ?');
    vals.push(now(), id);
    this.db.run(`UPDATE smart_folders SET ${parts.join(', ')} WHERE id = ?`, vals);
    this.changed('smartFolders');
  }

  deleteSmartFolder(id: string): void {
    this.db.run('DELETE FROM smart_folders WHERE id = ?', [id]);
    this.changed('smartFolders');
  }

  /** Query items matching a smart folder definition. */
  querySmartFolder(query: SmartFolderQuery): Array<{ path: string; kind: string }> {
    const conditions: string[] = [];
    const params: Array<string | number | null> = [];

    if (query.tags?.length) {
      const placeholders = query.tags.map(() => '?').join(', ');
      conditions.push(`i.id IN (SELECT item_id FROM item_tags WHERE tag_id IN (${placeholders}))`);
      params.push(...query.tags);
    }
    if (query.extensions?.length) {
      const placeholders = query.extensions.map(() => '?').join(', ');
      conditions.push(`LOWER(SUBSTR(i.path, INSTR(i.path, '.') + 1)) IN (${placeholders})`);
      params.push(...query.extensions.map((e) => e.toLowerCase()));
    }
    if (query.minSize !== undefined) { conditions.push('i.size >= ?'); params.push(query.minSize); }
    if (query.maxSize !== undefined) { conditions.push('i.size <= ?'); params.push(query.maxSize); }
    if (query.modifiedAfter !== undefined) { conditions.push('i.mtime_ms >= ?'); params.push(query.modifiedAfter); }
    if (query.modifiedBefore !== undefined) { conditions.push('i.mtime_ms <= ?'); params.push(query.modifiedBefore); }
    if (query.labels?.length) {
      const placeholders = query.labels.map(() => '?').join(', ');
      conditions.push(`i.id IN (SELECT item_id FROM item_tags it JOIN tags t ON it.tag_id = t.id WHERE t.name IN (${placeholders}))`);
      params.push(...query.labels);
    }

    if (!conditions.length) return [];
    const where = conditions.join(' AND ');
    return this.db.all<{ path: string; kind: string }>(`SELECT path, kind FROM items i WHERE missing = 0 AND ${where} LIMIT 10000`, params);
  }

  // ---------- clipboard pins ----------
  clipPins(): ClipPin[] {
    return this.db
      .all<{ id: string; mode: string; paths: string; label: string | null; pinned_ms: number }>('SELECT * FROM clip_pins ORDER BY pinned_ms DESC')
      .map((r) => ({ id: r.id, mode: r.mode as 'copy' | 'cut', paths: safeJson<string[]>(r.paths, []), label: r.label, pinnedMs: r.pinned_ms }));
  }

  pinClipEntry(id: string, mode: 'copy' | 'cut', paths: string[], label?: string): ClipPin {
    const ms = now();
    this.db.run('INSERT INTO clip_pins(id, mode, paths, label, pinned_ms) VALUES(?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label', [
      id, mode, JSON.stringify(paths), label ?? null, ms,
    ]);
    this.changed('clipPins');
    return { id, mode, paths, label: label ?? null, pinnedMs: ms };
  }

  unpinClipEntry(id: string): void {
    this.db.run('DELETE FROM clip_pins WHERE id = ?', [id]);
    this.changed('clipPins');
  }

  // ---------- downloads & generated content ----------
  registerDownload(d: { path: string; url?: string; referrer?: string; mime?: string; state: string; browser: string; startedMs?: number; finishedMs?: number; source: string }): string {
    const existing = this.db.get<{ id: string }>('SELECT id FROM downloads WHERE path = ? AND browser = ?', [d.path, d.browser]);
    const id = existing?.id ?? uuid();
    this.db.run(
      `INSERT INTO downloads(id, path, url, referrer, mime, state, browser, started_ms, finished_ms, source, registered_ms)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET state = excluded.state, finished_ms = excluded.finished_ms, url = COALESCE(excluded.url, url)`,
      [id, d.path, d.url ?? null, d.referrer ?? null, d.mime ?? null, d.state, d.browser, d.startedMs ?? null, d.finishedMs ?? null, d.source, now()],
    );
    this.changed('downloads');
    return id;
  }

  async downloads(): Promise<DownloadEntry[]> {
    const rows = this.db.all<Record<string, unknown>>('SELECT * FROM downloads ORDER BY COALESCE(finished_ms, started_ms, registered_ms) DESC');
    return Promise.all(
      rows.map(async (r) => {
        const st = await fsp.stat(String(r.path)).catch(() => undefined);
        return {
          id: String(r.id), path: String(r.path), url: (r.url as string) ?? null, referrer: (r.referrer as string) ?? null, mime: (r.mime as string) ?? null,
          state: String(r.state), browser: String(r.browser), startedMs: (r.started_ms as number) ?? null, finishedMs: (r.finished_ms as number) ?? null,
          source: String(r.source), exists: !!st, size: st?.size, modifiedMs: st?.mtimeMs,
        };
      }),
    );
  }

  /** Removes the catalogue entry only. The downloaded file stays on disk. */
  removeDownloadEntry(id: string): void {
    this.db.run('DELETE FROM downloads WHERE id = ?', [id]);
    this.changed('downloads');
  }

  registerGenerated(g: { path: string; generator: string; chatId?: string; prompt?: string; createdMs?: number }): string {
    const id = uuid();
    this.db.run('INSERT INTO generated(id, path, generator, chat_id, prompt, created_ms, registered_ms) VALUES(?, ?, ?, ?, ?, ?, ?)', [
      id, g.path, g.generator, g.chatId ?? null, g.prompt ?? null, g.createdMs ?? now(), now(),
    ]);
    this.changed('generated');
    return id;
  }

  /** Removes the catalogue entry only. The generated file stays on disk. */
  removeGeneratedEntry(id: string): void {
    this.db.run('DELETE FROM generated WHERE id = ?', [id]);
    this.changed('generated');
  }

  async generated(): Promise<GeneratedEntry[]> {
    const rows = this.db.all<{ id: string; path: string; generator: string; chat_id: string | null; prompt: string | null; created_ms: number }>(
      'SELECT * FROM generated ORDER BY created_ms DESC',
    );
    return Promise.all(
      rows.map(async (r) => {
        const st = await fsp.stat(r.path).catch(() => undefined);
        return { id: r.id, path: r.path, generator: r.generator, chatId: r.chat_id, prompt: r.prompt, createdMs: r.created_ms, exists: !!st, size: st?.size };
      }),
    );
  }

  /** Catalogue items registered with a given source (e.g. "import"). */
  itemsBySource(source: string, limit = 5000): CatalogItem[] {
    return this.db.all<{ id: string }>('SELECT id FROM items WHERE source = ? ORDER BY created_ms DESC LIMIT ?', [source, limit]).map((r) => this.item(r.id)!).filter(Boolean);
  }

  // ---------- projects ----------
  projects(): Project[] {
    return this.db
      .all<{ id: string; name: string; root: string; kind: string; markers: string; created_ms: number; n: number }>(
        'SELECT p.id, p.name, p.root, p.kind, p.markers, p.created_ms, COUNT(pi.item_id) AS n FROM projects p LEFT JOIN project_items pi ON pi.project_id = p.id GROUP BY p.id ORDER BY p.name COLLATE NOCASE',
      )
      .map((r) => ({ id: r.id, name: r.name, root: r.root, kind: r.kind, markers: JSON.parse(r.markers) as string[], createdMs: r.created_ms, itemCount: r.n }));
  }

  project(id: string): Project | undefined {
    return this.projects().find((p) => p.id === id);
  }

  /** Register a folder as a project. The folder and its files are not moved or changed. */
  createProject(root: string, name: string, kind: string, markers: string[]): Project {
    if (!path.isAbsolute(root)) throw makeError('invalid_path', 'catalog.createProject', { target: root });
    const clean = name.trim();
    if (!clean) throw makeError('validation', 'catalog.createProject', { message: 'Project name cannot be empty.' });
    const existing = this.db.get<{ id: string }>('SELECT id FROM projects WHERE root = ?', [root]);
    if (existing) throw makeError('already_exists', 'catalog.createProject', { message: 'This folder is already a project.' });
    const id = uuid();
    this.db.run('INSERT INTO projects(id, name, root, kind, markers, created_ms) VALUES(?, ?, ?, ?, ?, ?)', [id, clean.slice(0, 200), root, kind.slice(0, 64), JSON.stringify(markers.slice(0, 50)), now()]);
    this.changed('projects');
    return this.project(id)!;
  }

  renameProject(id: string, name: string): void {
    this.db.run('UPDATE projects SET name = ? WHERE id = ?', [name.trim().slice(0, 200), id]);
    this.changed('projects');
  }

  /** Removes the project entry and its associations; files are untouched. */
  deleteProject(id: string): void {
    this.db.run('DELETE FROM projects WHERE id = ?', [id]);
    this.changed('projects');
  }

  /** Associate files or folders (anywhere) with a project by reference. Nothing is moved. */
  async associateWithProject(id: string, paths: string[]): Promise<{ added: number; failed: string[] }> {
    if (!this.project(id)) throw makeError('not_found', 'catalog.associate', { message: 'Project not found.' });
    let added = 0;
    const failed: string[] = [];
    for (const p of paths) {
      try {
        const item = await this.ensureItem(p);
        this.db.run('INSERT OR IGNORE INTO project_items(project_id, item_id, added_ms) VALUES(?, ?, ?)', [id, item.id, now()]);
        added += this.db.changes();
      } catch {
        failed.push(p);
      }
    }
    this.changed('projects');
    return { added, failed };
  }

  removeFromProject(id: string, itemIds: string[]): number {
    let n = 0;
    this.db.tx(() => {
      for (const itemId of itemIds) {
        this.db.run('DELETE FROM project_items WHERE project_id = ? AND item_id = ?', [id, itemId]);
        n += this.db.changes();
      }
    });
    this.changed('projects');
    return n;
  }

  async projectItems(id: string): Promise<CatalogItem[]> {
    const rows = this.db.all<{ item_id: string }>('SELECT item_id FROM project_items WHERE project_id = ? ORDER BY added_ms', [id]);
    return Promise.all(rows.map((r) => this.revalidate(this.item(r.item_id)!)));
  }

  // ---------- storage history ----------
  recordStorageScan(r: { root: string; bytes: number; files: number; directories: number; complete: boolean; byCategory: StorageSnapshot['byCategory'] }): void {
    this.db.run('INSERT INTO storage_history(id, root, ms, bytes, files, directories, complete, by_category) VALUES(?, ?, ?, ?, ?, ?, ?, ?)', [uuid(), r.root, now(), r.bytes, r.files, r.directories, r.complete ? 1 : 0, JSON.stringify(r.byCategory.slice(0, 32))]);
    // Keep the most recent 200 measurements per folder.
    this.db.run('DELETE FROM storage_history WHERE root = ? AND id NOT IN (SELECT id FROM storage_history WHERE root = ? ORDER BY ms DESC LIMIT 200)', [r.root, r.root]);
  }

  storageHistory(root: string): StorageSnapshot[] {
    return this.db
      .all<{ id: string; root: string; ms: number; bytes: number; files: number; directories: number; complete: number; by_category: string }>('SELECT * FROM storage_history WHERE root = ? ORDER BY ms ASC', [root])
      .map((r) => ({ id: r.id, root: r.root, ms: r.ms, bytes: r.bytes, files: r.files, directories: r.directories, complete: !!r.complete, byCategory: JSON.parse(r.by_category) }));
  }

  clearStorageHistory(root?: string): void {
    if (root) this.db.run('DELETE FROM storage_history WHERE root = ?', [root]);
    else this.db.run('DELETE FROM storage_history');
  }

  // ---------- search lookups ----------
  searchLookups(): CatalogLookups {
    let notes: Map<string, string> | undefined;
    let ratings: Map<string, number> | undefined;
    let sources: Map<string, Set<string>> | undefined;
    const collections = new Map<string, Set<string>>();
    const projects = new Map<string, { roots: string[]; items: Set<string> }>();
    const buildItems = () => {
      notes = new Map();
      ratings = new Map();
      for (const r of this.db.all<{ path: string; description: string | null; rating: number | null }>("SELECT path, description, rating FROM items WHERE missing = 0 AND (description IS NOT NULL OR rating IS NOT NULL)")) {
        if (r.description) notes.set(r.path, r.description);
        if (r.rating) ratings.set(r.path, r.rating);
      }
    };
    const add = (m: Map<string, Set<string>>, k: string, v: string) => m.set(k, (m.get(k) ?? new Set()).add(v));
    return {
      note: (p) => {
        if (!notes) buildItems();
        return notes!.get(p);
      },
      rating: (p) => {
        if (!ratings) buildItems();
        return ratings!.get(p);
      },
      sources: (p) => {
        if (!sources) {
          sources = new Map();
          for (const r of this.db.all<{ path: string }>('SELECT path FROM downloads')) add(sources, r.path, 'download');
          for (const r of this.db.all<{ path: string }>('SELECT path FROM generated')) add(sources, r.path, 'generated');
          for (const r of this.db.all<{ path: string; source: string }>("SELECT path, source FROM items WHERE missing = 0 AND source != 'filesystem'")) add(sources, r.path, r.source);
        }
        return sources.get(p) ?? new Set();
      },
      inCollection: (name, p) => {
        const key = name.toLowerCase();
        if (!collections.has(key)) {
          collections.set(key, new Set(this.db.all<{ path: string }>('SELECT i.path FROM items i JOIN collection_items ci ON ci.item_id = i.id JOIN collections c ON c.id = ci.collection_id WHERE c.name = ? COLLATE NOCASE AND i.missing = 0', [name]).map((r) => r.path)));
        }
        return collections.get(key)!.has(p);
      },
      inProject: (name, p) => {
        const key = name.toLowerCase();
        if (!projects.has(key)) {
          const rows = this.db.all<{ id: string; root: string }>('SELECT id, root FROM projects WHERE name = ? COLLATE NOCASE', [name]);
          const items = new Set<string>();
          for (const r of rows) for (const it of this.db.all<{ path: string }>('SELECT i.path FROM items i JOIN project_items pi ON pi.item_id = i.id WHERE pi.project_id = ? AND i.missing = 0', [r.id])) items.add(it.path);
          projects.set(key, { roots: rows.map((r) => r.root), items });
        }
        const pr = projects.get(key)!;
        return pr.items.has(p) || pr.roots.some((r) => isWithin(r, p)) || [...pr.items].some((i) => isWithin(i, p));
      },
    };
  }

  // ---------- file notes ----------

  getNote(filePath: string): FileNote | null {
    const row = this.db.get<{ id: string; path: string; note: string; color: string | null; created_ms: number; updated_ms: number }>(
      'SELECT * FROM file_notes WHERE path = ?', [filePath],
    );
    return row ? { id: row.id, path: row.path, note: row.note, color: row.color, createdMs: row.created_ms, updatedMs: row.updated_ms } : null;
  }

  setNote(filePath: string, note: string, color?: string): FileNote {
    const existing = this.db.get<{ id: string }>('SELECT id FROM file_notes WHERE path = ?', [filePath]);
    const id = existing?.id ?? uuid();
    const ms = now();
    if (existing) {
      this.db.run('UPDATE file_notes SET note = ?, color = ?, updated_ms = ? WHERE id = ?', [note, color ?? null, ms, id]);
    } else {
      this.db.run('INSERT INTO file_notes(id, path, note, color, created_ms, updated_ms) VALUES(?, ?, ?, ?, ?, ?)', [
        id, filePath, note, color ?? null, ms, ms,
      ]);
    }
    this.changed('notes');
    return { id, path: filePath, note, color: color ?? null, createdMs: existing ? ms : ms, updatedMs: ms };
  }

  deleteNote(filePath: string): void {
    this.db.run('DELETE FROM file_notes WHERE path = ?', [filePath]);
    this.changed('notes');
  }

  listNotes(query?: string): FileNote[] {
    if (query) {
      return this.db
        .all<{ id: string; path: string; note: string; color: string | null; created_ms: number; updated_ms: number }>(
          'SELECT * FROM file_notes WHERE path LIKE ? OR note LIKE ? ORDER BY updated_ms DESC', [`%${query}%`, `%${query}%`],
        )
        .map((r) => ({ id: r.id, path: r.path, note: r.note, color: r.color, createdMs: r.created_ms, updatedMs: r.updated_ms }));
    }
    return this.db
      .all<{ id: string; path: string; note: string; color: string | null; created_ms: number; updated_ms: number }>(
        'SELECT * FROM file_notes ORDER BY updated_ms DESC',
      )
      .map((r) => ({ id: r.id, path: r.path, note: r.note, color: r.color, createdMs: r.created_ms, updatedMs: r.updated_ms }));
  }

  searchNotes(text: string): FileNote[] {
    return this.db
      .all<{ id: string; path: string; note: string; color: string | null; created_ms: number; updated_ms: number }>(
        'SELECT * FROM file_notes WHERE note LIKE ? ORDER BY updated_ms DESC', [`%${text}%`],
      )
      .map((r) => ({ id: r.id, path: r.path, note: r.note, color: r.color, createdMs: r.created_ms, updatedMs: r.updated_ms }));
  }

}

export interface FileNote { id: string; path: string; note: string; color: string | null; createdMs: number; updatedMs: number }

interface IdentityRow { id: string; dev: number | null; ino: number | null; birth_ms: number | null; missing: number }

function identityMatches(row: IdentityRow, st: import('node:fs').Stats): boolean {
  if (row.ino != null && row.ino !== 0 && (st.ino !== row.ino || st.dev !== row.dev)) return false;
  const birth = st.birthtimeMs > 0 ? st.birthtimeMs : null;
  if (row.birth_ms != null && birth != null && Math.abs(row.birth_ms - birth) > 1) return false;
  return true;
}

function safeJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
