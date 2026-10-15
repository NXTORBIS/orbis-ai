import { randomUUID } from 'node:crypto';
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import type { ColorTag, FileColorTag } from '../../shared/colorTags';
import { COLOR_TAG_PRESETS } from '../../shared/colorTags';
import type { Services } from '../services';

type Channels =
  | 'colorTag:list'
  | 'colorTag:create'
  | 'colorTag:update'
  | 'colorTag:delete'
  | 'colorTag:assign'
  | 'colorTag:unassign'
  | 'colorTag:forPaths'
  | 'colorTag:pathsWithTag';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

function rowToTag(row: Record<string, unknown>): ColorTag {
  return {
    id: row.id as string,
    label: row.label as string,
    hex: row.hex as string,
    createdMs: row.created_ms as number,
  };
}

export function ensurePresets(s: Services): void {
  const existing = s.db.all<{ id: string }>('SELECT id FROM color_tags', []);
  const ids = new Set(existing.map((r) => r.id));
  const now = Date.now();
  for (const p of COLOR_TAG_PRESETS) {
    if (!ids.has(p.id)) {
      s.db.run('INSERT INTO color_tags (id, label, hex, created_ms) VALUES (?, ?, ?, ?)', [p.id, p.label, p.hex, now]);
    }
  }
}

export function colorTagHandlers(s: Services): Handlers {
  return {
    'colorTag:list': () => {
      const rows = s.db.all<Record<string, unknown>>('SELECT * FROM color_tags ORDER BY created_ms', []);
      return rows.map(rowToTag);
    },

    'colorTag:create': (p) => {
      const id = randomUUID().replace(/-/g, '').slice(0, 16);
      const now = Date.now();
      s.db.run('INSERT INTO color_tags (id, label, hex, created_ms) VALUES (?, ?, ?, ?)', [id, p.label, p.hex, now]);
      return rowToTag({ id, label: p.label, hex: p.hex, created_ms: now });
    },

    'colorTag:update': (p) => {
      const row = s.db.get<Record<string, unknown>>('SELECT * FROM color_tags WHERE id = ?', [p.id]);
      if (!row) throw new Error('Color tag not found');
      if (p.label !== undefined) s.db.run('UPDATE color_tags SET label = ? WHERE id = ?', [p.label, p.id]);
      if (p.hex !== undefined) s.db.run('UPDATE color_tags SET hex = ? WHERE id = ?', [p.hex, p.id]);
      const updated = s.db.get<Record<string, unknown>>('SELECT * FROM color_tags WHERE id = ?', [p.id])!;
      return rowToTag(updated);
    },

    'colorTag:delete': (p) => {
      s.db.run('DELETE FROM file_color_tags WHERE tag_id = ?', [p.id]);
      s.db.run('DELETE FROM color_tags WHERE id = ?', [p.id]);
      return { deleted: true };
    },

    'colorTag:assign': (p) => {
      for (const path of p.paths) {
        s.db.run('INSERT OR REPLACE INTO file_color_tags (path, tag_id) VALUES (?, ?)', [path, p.tagId]);
      }
      return { count: p.paths.length };
    },

    'colorTag:unassign': (p) => {
      for (const path of p.paths) {
        s.db.run('DELETE FROM file_color_tags WHERE path = ? AND tag_id = ?', [path, p.tagId]);
      }
      return { count: p.paths.length };
    },

    'colorTag:forPaths': (p) => {
      const result: FileColorTag[] = [];
      for (const path of p.paths) {
        const rows = s.db.all<{ tag_id: string }>('SELECT tag_id FROM file_color_tags WHERE path = ?', [path]);
        for (const r of rows) result.push({ path, tagId: r.tag_id });
      }
      return result;
    },

    'colorTag:pathsWithTag': (p) => {
      const rows = s.db.all<{ path: string }>('SELECT path FROM file_color_tags WHERE tag_id = ?', [p.tagId]);
      return rows.map((r) => r.path);
    },
  };
}
