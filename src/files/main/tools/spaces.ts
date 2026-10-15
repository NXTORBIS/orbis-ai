import { randomUUID } from 'node:crypto';
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import { makeError } from '../../shared/errors';
import type { Space } from '../../shared/spaces';
import type { Services } from '../services';

type Channels = 'space:list' | 'space:create' | 'space:update' | 'space:delete' | 'space:get';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

function rowToSpace(row: Record<string, unknown>): Space {
  return {
    id: row.id as string,
    name: row.name as string,
    folders: row.folders ? JSON.parse(row.folders as string) as string[] : [],
    sortKey: (row.sort_key as string) || undefined,
    sortDir: (row.sort_dir as 'asc' | 'desc') || undefined,
    viewMode: (row.view_mode as string) || undefined,
    tabState: (row.tab_state as string) || undefined,
    createdMs: row.created_ms as number,
    updatedMs: row.updated_ms as number,
  };
}

export function spacesHandlers(s: Services): Handlers {
  return {
    'space:list': () => {
      const rows = s.db.all<Record<string, unknown>>('SELECT * FROM spaces ORDER BY created_ms ASC', []);
      return rows.map(rowToSpace);
    },

    'space:get': (p) => {
      const row = s.db.get<Record<string, unknown>>('SELECT * FROM spaces WHERE id = ?', [p.id]);
      if (!row) throw makeError('not_found', 'space.get', { message: 'Space not found.' });
      return rowToSpace(row);
    },

    'space:create': (p) => {
      const id = randomUUID().replace(/-/g, '').slice(0, 16);
      const now = Date.now();
      s.db.run(
        'INSERT INTO spaces (id, name, folders, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?)',
        [id, p.name, JSON.stringify(p.folders), now, now],
      );
      return rowToSpace({ id, name: p.name, folders: JSON.stringify(p.folders), created_ms: now, updated_ms: now });
    },

    'space:update': (p) => {
      const existing = s.db.get<Record<string, unknown>>('SELECT * FROM spaces WHERE id = ?', [p.id]);
      if (!existing) throw makeError('not_found', 'space.update', { message: 'Space not found.' });
      const now = Date.now();
      const name = p.name ?? existing.name as string;
      const folders = p.folders ? JSON.stringify(p.folders) : existing.folders as string;
      const sortKey = p.sortKey ?? (existing.sort_key as string | null);
      const sortDir = p.sortDir ?? (existing.sort_dir as string | null);
      const viewMode = p.viewMode ?? (existing.view_mode as string | null);
      const tabState = p.tabState ?? (existing.tab_state as string | null);
      s.db.run(
        'UPDATE spaces SET name = ?, folders = ?, sort_key = ?, sort_dir = ?, view_mode = ?, tab_state = ?, updated_ms = ? WHERE id = ?',
        [name, folders, sortKey ?? null, sortDir ?? null, viewMode ?? null, tabState ?? null, now, p.id],
      );
      return rowToSpace({ ...existing, name, folders, sort_key: sortKey, sort_dir: sortDir, view_mode: viewMode, tab_state: tabState, updated_ms: now });
    },

    'space:delete': (p) => {
      const existing = s.db.get<Record<string, unknown>>('SELECT id FROM spaces WHERE id = ?', [p.id]);
      if (!existing) throw makeError('not_found', 'space.delete', { message: 'Space not found.' });
      s.db.run('DELETE FROM spaces WHERE id = ?', [p.id]);
      return { deleted: true };
    },
  };
}
