import { EventEmitter } from 'node:events';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { makeError } from '../shared/errors';
import { requireAbsolute } from './fs/paths';
import type { KvStore } from './tools/renamePresets';

/**
 * The shelf (drop stack): files and folders the user collects from any
 * folder, pane or tab to act on them together later. Items are references to
 * paths, never copies. They are stored per profile (key-value table), follow
 * moves and renames Orbis Files performs, and are reported as missing (never
 * silently dropped) when they disappear.
 */

const KEY = 'shelf.items';
export const MAX_SHELF_ITEMS = 500;

const StoredItem = z.object({ path: z.string().min(1).max(32767), addedMs: z.number().int().nonnegative() }).strict();
type Stored = z.infer<typeof StoredItem>;

export interface ShelfItem {
  path: string;
  name: string;
  addedMs: number;
  exists: boolean;
  /** Why it is not available: missing (moved/deleted outside Orbis Files), permission, unavailable (drive). */
  reason?: 'missing' | 'permission' | 'unavailable';
  kind?: 'file' | 'directory' | 'symlink' | 'other';
  size?: number;
  modifiedMs?: number;
}

export class ShelfStore extends EventEmitter {
  constructor(private readonly kv: KvStore) {
    super();
  }

  private read(): Stored[] {
    const raw = this.kv.getKv<unknown>(KEY, []);
    if (!Array.isArray(raw)) return [];
    const out: Stored[] = [];
    const seen = new Set<string>();
    for (const x of raw) {
      const p = StoredItem.safeParse(x);
      if (p.success && path.isAbsolute(p.data.path) && !seen.has(p.data.path)) {
        seen.add(p.data.path);
        out.push(p.data);
      }
    }
    return out.slice(0, MAX_SHELF_ITEMS);
  }

  private write(items: Stored[]): void {
    this.kv.setKv(KEY, items);
    this.emit('changed');
  }

  paths(): string[] {
    return this.read().map((i) => i.path);
  }

  /** Items with their current state on disk (links are not followed). */
  async list(): Promise<ShelfItem[]> {
    return Promise.all(this.read().map(async (i): Promise<ShelfItem> => {
      const base: ShelfItem = { path: i.path, name: path.basename(i.path) || i.path, addedMs: i.addedMs, exists: false };
      try {
        const st = await fsp.lstat(i.path);
        return { ...base, exists: true, kind: st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other', size: st.isFile() ? st.size : undefined, modifiedMs: st.mtimeMs };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        return { ...base, reason: code === 'EACCES' || code === 'EPERM' ? 'permission' : code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unavailable' };
      }
    }));
  }

  /** Add references (existing items only; items already on the shelf stay where they are). */
  async add(paths: string[]): Promise<{ added: number; already: number; missing: string[] }> {
    const items = this.read();
    const have = new Set(items.map((i) => i.path));
    let added = 0;
    let already = 0;
    const missing: string[] = [];
    for (const raw of paths) {
      const p = path.resolve(requireAbsolute(raw, 'shelf.add'));
      if (have.has(p)) {
        already++;
        continue;
      }
      if (!(await fsp.lstat(p).then(() => true, () => false))) {
        missing.push(p);
        continue;
      }
      if (items.length >= MAX_SHELF_ITEMS) throw makeError('validation', 'shelf.add', { message: `The shelf holds up to ${MAX_SHELF_ITEMS} items. Remove some first.` });
      items.push({ path: p, addedMs: Date.now() });
      have.add(p);
      added++;
    }
    if (added) this.write(items);
    return { added, already, missing };
  }

  remove(paths: string[]): number {
    const drop = new Set(paths);
    const items = this.read();
    const next = items.filter((i) => !drop.has(i.path));
    if (next.length !== items.length) this.write(next);
    return items.length - next.length;
  }

  clear(): number {
    const n = this.read().length;
    if (n) this.write([]);
    return n;
  }

  /** Follow a move or rename Orbis Files performed (the item itself, or a folder that contains it). */
  onMoved(from: string, to: string): void {
    const items = this.read();
    let changed = false;
    const next = items.map((i) => {
      if (i.path === from) {
        changed = true;
        return { ...i, path: to };
      }
      if (i.path.startsWith(from + path.sep)) {
        changed = true;
        return { ...i, path: to + i.path.slice(from.length) };
      }
      return i;
    });
    if (!changed) return;
    // Two references can end up on the same path (an item moved onto another's place): keep one.
    const seen = new Set<string>();
    this.write(next.filter((i) => (seen.has(i.path) ? false : (seen.add(i.path), true))));
  }
}
