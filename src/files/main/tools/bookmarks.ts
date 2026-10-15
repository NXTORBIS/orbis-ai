import { randomUUID } from 'node:crypto';
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import type { Bookmark } from '../../shared/bookmarks';
import type { Services } from '../services';

type Channels =
  | 'bookmark:list'
  | 'bookmark:add'
  | 'bookmark:remove'
  | 'bookmark:reorder'
  | 'bookmark:rename';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

function rowToBookmark(row: Record<string, unknown>): Bookmark {
  return {
    id: row.id as string,
    path: row.path as string,
    label: row.label as string,
    kind: row.kind as 'file' | 'directory',
    position: row.position as number,
    createdMs: row.created_ms as number,
  };
}

export function bookmarkHandlers(s: Services): Handlers {
  return {
    'bookmark:list': () => {
      const rows = s.db.all<Record<string, unknown>>('SELECT * FROM bookmarks ORDER BY position ASC', []);
      return rows.map(rowToBookmark);
    },

    'bookmark:add': (p) => {
      const id = randomUUID().replace(/-/g, '').slice(0, 16);
      const now = Date.now();
      const maxRow = s.db.get<{ m: number | null }>('SELECT MAX(position) as m FROM bookmarks', []);
      const position = (maxRow?.m ?? -1) + 1;
      s.db.run('INSERT INTO bookmarks (id, path, label, kind, position, created_ms) VALUES (?, ?, ?, ?, ?, ?)',
        [id, p.path, p.label, p.kind, position, now]);
      return rowToBookmark({ id, path: p.path, label: p.label, kind: p.kind, position, created_ms: now });
    },

    'bookmark:remove': (p) => {
      s.db.run('DELETE FROM bookmarks WHERE id = ?', [p.id]);
      return { deleted: true };
    },

    'bookmark:reorder': (p) => {
      for (let i = 0; i < p.ids.length; i++) {
        s.db.run('UPDATE bookmarks SET position = ? WHERE id = ?', [i, p.ids[i]!]);
      }
      return { ok: true };
    },

    'bookmark:rename': (p) => {
      s.db.run('UPDATE bookmarks SET label = ? WHERE id = ?', [p.label, p.id]);
      const row = s.db.get<Record<string, unknown>>('SELECT * FROM bookmarks WHERE id = ?', [p.id]);
      if (!row) throw new Error('Bookmark not found');
      return rowToBookmark(row);
    },
  };
}
