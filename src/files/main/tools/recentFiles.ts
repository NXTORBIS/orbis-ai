import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import { makeError } from '../../shared/errors';
import type { RecentFile } from '../../shared/recentFiles';
import type { Services } from '../services';

type Channels = 'recent:list' | 'recent:record' | 'recent:pin' | 'recent:unpin' | 'recent:remove' | 'recent:clear';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

function rowToRecentFile(row: Record<string, unknown>): RecentFile {
  return {
    id: row.id as string,
    path: row.path as string,
    name: row.name as string,
    ext: (row.ext as string) || '',
    pinned: !!(row.pinned as number),
    lastAccessMs: row.last_access_ms as number,
    accessCount: row.access_count as number,
  };
}

export function recentFilesHandlers(s: Services): Handlers {
  return {
    'recent:list': (p) => {
      const limit = p.limit ?? 200;
      const rows = s.db.all<Record<string, unknown>>(
        'SELECT * FROM recent_files ORDER BY pinned DESC, last_access_ms DESC LIMIT ?',
        [limit],
      );
      return rows.map(rowToRecentFile);
    },

    'recent:record': (p) => {
      const existing = s.db.get<Record<string, unknown>>('SELECT * FROM recent_files WHERE path = ?', [p.path]);
      const now = Date.now();
      if (existing) {
        s.db.run(
          'UPDATE recent_files SET last_access_ms = ?, access_count = access_count + 1 WHERE id = ?',
          [now, existing.id as string],
        );
        return rowToRecentFile({ ...(existing as Record<string, unknown>), last_access_ms: now, access_count: (existing.access_count as number) + 1 });
      }
      const id = randomUUID().replace(/-/g, '').slice(0, 16);
      const name = path.basename(p.path);
      const ext = path.extname(name).slice(1).toLowerCase();
      s.db.run(
        'INSERT INTO recent_files (id, path, name, ext, pinned, last_access_ms, access_count) VALUES (?, ?, ?, ?, 0, ?, 1)',
        [id, p.path, name, ext, now],
      );
      return rowToRecentFile({ id, path: p.path, name, ext, pinned: 0, last_access_ms: now, access_count: 1 });
    },

    'recent:pin': (p) => {
      const existing = s.db.get<Record<string, unknown>>('SELECT * FROM recent_files WHERE id = ?', [p.id]);
      if (!existing) throw makeError('not_found', 'recent.pin', { message: 'Recent file not found.' });
      s.db.run('UPDATE recent_files SET pinned = 1 WHERE id = ?', [p.id]);
      return rowToRecentFile({ ...existing, pinned: 1 });
    },

    'recent:unpin': (p) => {
      const existing = s.db.get<Record<string, unknown>>('SELECT * FROM recent_files WHERE id = ?', [p.id]);
      if (!existing) throw makeError('not_found', 'recent.unpin', { message: 'Recent file not found.' });
      s.db.run('UPDATE recent_files SET pinned = 0 WHERE id = ?', [p.id]);
      return rowToRecentFile({ ...existing, pinned: 0 });
    },

    'recent:remove': (p) => {
      s.db.run('DELETE FROM recent_files WHERE id = ?', [p.id]);
      return { deleted: true };
    },

    'recent:clear': () => {
      s.db.run('DELETE FROM recent_files WHERE pinned = 0', []);
      return { cleared: true };
    },
  };
}
