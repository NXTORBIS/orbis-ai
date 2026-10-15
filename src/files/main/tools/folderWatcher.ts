import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { EventChannel, InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import { makeError } from '../../shared/errors';
import type { FolderWatch, WatchEvent } from '../../shared/folderWatch';
import type { Services } from '../services';
import { minimatch } from 'minimatch';

type Channels = 'watch:list' | 'watch:create' | 'watch:update' | 'watch:delete' | 'watch:start' | 'watch:stop' | 'watch:log';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

function rowToWatch(row: Record<string, unknown>): FolderWatch {
  return {
    id: row.id as string,
    path: row.path as string,
    label: (row.label as string) || '',
    rule: JSON.parse(row.rule as string),
    enabled: (row.enabled as number) === 1,
    createdMs: row.created_ms as number,
    updatedMs: row.updated_ms as number,
  };
}

/** Active watchers keyed by watch id. */
const activeWatchers = new Map<string, { watcher: fs.FSWatcher; log: WatchEvent[] }>();

function matchesRules(fileName: string, rule: FolderWatch['rule']): boolean {
  if (rule.ignore.length && rule.ignore.some((p) => minimatch(fileName, p))) return false;
  if (rule.include.length && !rule.include.some((p) => minimatch(fileName, p))) return false;
  return true;
}

export function folderWatchHandlers(s: Services, broadcast: (channel: EventChannel, payload: unknown) => void): Handlers {
  return {
    'watch:list': () => {
      const rows = s.db.all<Record<string, unknown>>('SELECT * FROM folder_watches ORDER BY updated_ms DESC', []);
      return rows.map(rowToWatch);
    },

    'watch:create': (p) => {
      const id = randomUUID().replace(/-/g, '').slice(0, 16);
      const now = Date.now();
      const rule = p.rule ?? { include: [], ignore: [], autoAction: 'none' };
      s.db.run(
        'INSERT INTO folder_watches (id, path, label, rule, enabled, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, p.path, p.label ?? '', JSON.stringify(rule), 1, now, now],
      );
      return rowToWatch({ id, path: p.path, label: p.label ?? '', rule: JSON.stringify(rule), enabled: 1, created_ms: now, updated_ms: now });
    },

    'watch:update': (p) => {
      const existing = s.db.get<Record<string, unknown>>('SELECT * FROM folder_watches WHERE id = ?', [p.id]);
      if (!existing) throw makeError('not_found', 'watch.update', { message: 'Watch not found.' });
      const now = Date.now();
      const label = p.label ?? existing.label as string;
      const rule = p.rule ? JSON.stringify(p.rule) : existing.rule as string;
      const enabled = p.enabled !== undefined ? (p.enabled ? 1 : 0) : existing.enabled as number;
      s.db.run(
        'UPDATE folder_watches SET label = ?, rule = ?, enabled = ?, updated_ms = ? WHERE id = ?',
        [label, rule, enabled, now, p.id],
      );
      return rowToWatch({ ...existing, label, rule, enabled, updated_ms: now });
    },

    'watch:delete': (p) => {
      // Stop if active
      const active = activeWatchers.get(p.id);
      if (active) {
        active.watcher.close();
        activeWatchers.delete(p.id);
      }
      const existing = s.db.get<Record<string, unknown>>('SELECT id FROM folder_watches WHERE id = ?', [p.id]);
      if (!existing) throw makeError('not_found', 'watch.delete', { message: 'Watch not found.' });
      s.db.run('DELETE FROM folder_watches WHERE id = ?', [p.id]);
      return { deleted: true };
    },

    'watch:start': (p) => {
      const row = s.db.get<Record<string, unknown>>('SELECT * FROM folder_watches WHERE id = ?', [p.id]);
      if (!row) throw makeError('not_found', 'watch.start', { message: 'Watch not found.' });
      const watch = rowToWatch(row);

      // Already active?
      if (activeWatchers.has(p.id)) return { started: true, alreadyActive: true };

      const log: WatchEvent[] = [];
      const watcher = fs.watch(watch.path, { recursive: true }, (eventType, fileName) => {
        if (!fileName) return;
        if (!matchesRules(fileName, watch.rule)) return;
        const ev: WatchEvent = {
          watchId: watch.id,
          path: path.join(watch.path, fileName),
          eventType: eventType === 'rename' ? 'add' : 'change',
          timestampMs: Date.now(),
        };
        log.push(ev);
        if (log.length > 1000) log.shift();
        broadcast('watch:event', ev);

        // Auto-actions
        if (watch.rule.autoAction === 'copy' && watch.rule.actionDest) {
          const dest = path.join(watch.rule.actionDest, fileName);
          void fsp.mkdir(path.dirname(dest), { recursive: true })
            .then(() => fsp.copyFile(path.join(watch.path, fileName), dest))
            .catch(() => undefined);
        } else if (watch.rule.autoAction === 'move' && watch.rule.actionDest) {
          const dest = path.join(watch.rule.actionDest, fileName);
          void fsp.mkdir(path.dirname(dest), { recursive: true })
            .then(() => fsp.rename(path.join(watch.path, fileName), dest))
            .catch(() => undefined);
        }
      });

      activeWatchers.set(p.id, { watcher, log });
      return { started: true, alreadyActive: false };
    },

    'watch:stop': (p) => {
      const active = activeWatchers.get(p.id);
      if (!active) return { stopped: false };
      active.watcher.close();
      activeWatchers.delete(p.id);
      return { stopped: true };
    },

    'watch:log': (p) => {
      const active = activeWatchers.get(p.id);
      return active ? active.log : [];
    },
  };
}
