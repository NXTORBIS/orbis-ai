import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import type { RecycleBinItem, RecycleBinSettings } from '../../shared/recycleBin';
import type { Services } from '../services';

type Channels =
  | 'recycleBin:list'
  | 'recycleBin:restore'
  | 'recycleBin:permanentDelete'
  | 'recycleBin:empty'
  | 'recycleBin:getSettings'
  | 'recycleBin:setSettings'
  | 'recycleBin:purgeOld';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

function rowToItem(row: Record<string, unknown>): RecycleBinItem {
  return {
    id: row.id as string,
    originalPath: row.original_path as string,
    name: row.name as string,
    kind: row.kind as 'file' | 'directory',
    size: row.size as number,
    deletedMs: row.deleted_ms as number,
    storagePath: row.storage_path as string,
  };
}

function recycleBinDir(s: Services): string {
  const dir = path.join(s.profileDir, 'recycle-bin');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function removeStoragePath(storagePath: string): Promise<void> {
  try {
    const stat = await fsp.lstat(storagePath);
    if (stat.isDirectory()) await fsp.rm(storagePath, { recursive: true, force: true });
    else await fsp.unlink(storagePath);
  } catch {
    // Already gone
  }
}

export function recycleBinHandlers(s: Services): Handlers {
  return {
    'recycleBin:list': () => {
      const rows = s.db.all<Record<string, unknown>>('SELECT * FROM recycle_bin ORDER BY deleted_ms DESC', []);
      return rows.map(rowToItem);
    },

    'recycleBin:restore': async (p) => {
      const restored: string[] = [];
      for (const id of p.ids as string[]) {
        const row = s.db.get<Record<string, unknown>>('SELECT * FROM recycle_bin WHERE id = ?', [id]);
        if (!row) continue;
        const item = rowToItem(row);
        const dir = path.dirname(item.originalPath);
        await fsp.mkdir(dir, { recursive: true });
        try {
          await fsp.rename(item.storagePath, item.originalPath);
        } catch {
          await fsp.cp(item.storagePath, item.originalPath, { recursive: true });
          await removeStoragePath(item.storagePath);
        }
        s.db.run('DELETE FROM recycle_bin WHERE id = ?', [id]);
        restored.push(item.originalPath);
      }
      return { restored };
    },

    'recycleBin:permanentDelete': async (p) => {
      let deleted = 0;
      for (const id of p.ids as string[]) {
        const row = s.db.get<Record<string, unknown>>('SELECT * FROM recycle_bin WHERE id = ?', [id]);
        if (!row) continue;
        await removeStoragePath(row.storage_path as string);
        s.db.run('DELETE FROM recycle_bin WHERE id = ?', [id]);
        deleted++;
      }
      return { deleted };
    },

    'recycleBin:empty': async () => {
      const rows = s.db.all<{ storage_path: string }>('SELECT storage_path FROM recycle_bin', []);
      for (const r of rows) await removeStoragePath(r.storage_path);
      s.db.run('DELETE FROM recycle_bin', []);
      return { deleted: rows.length };
    },

    'recycleBin:getSettings': () => {
      const days = s.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['recycleBin.autoPurgeDays']);
      const maxSize = s.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['recycleBin.maxSizeBytes']);
      return {
        autoPurgeDays: days ? JSON.parse(days.value) as number : 30,
        maxSizeBytes: maxSize ? JSON.parse(maxSize.value) as number : 1024 * 1024 * 1024,
      } satisfies RecycleBinSettings;
    },

    'recycleBin:setSettings': (p) => {
      s.db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['recycleBin.autoPurgeDays', JSON.stringify(p.autoPurgeDays)]);
      s.db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['recycleBin.maxSizeBytes', JSON.stringify(p.maxSizeBytes)]);
      return { ok: true };
    },

    'recycleBin:purgeOld': () => {
      const daysRow = s.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['recycleBin.autoPurgeDays']);
      const days = daysRow ? JSON.parse(daysRow.value) as number : 30;
      if (days <= 0) return { purged: 0 };
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const old = s.db.all<Record<string, unknown>>('SELECT * FROM recycle_bin WHERE deleted_ms < ?', [cutoff]);
      for (const row of old) {
        void removeStoragePath(row.storage_path as string);
        s.db.run('DELETE FROM recycle_bin WHERE id = ?', [row.id as string]);
      }
      return { purged: old.length };
    },
  };
}

/** Move a file/folder into the recycle bin storage and record it. */
export async function moveToRecycleBin(s: Services, filePath: string): Promise<RecycleBinItem> {
  const stat = await fsp.lstat(filePath);
  const id = randomUUID().replace(/-/g, '').slice(0, 16);
  const name = path.basename(filePath);
  const kind = stat.isDirectory() ? 'directory' : 'file';
  const size = stat.isDirectory() ? 0 : stat.size;
  const now = Date.now();
  const dir = recycleBinDir(s);
  const storagePath = path.join(dir, `${id}_${name}`);

  try {
    await fsp.rename(filePath, storagePath);
  } catch {
    await fsp.cp(filePath, storagePath, { recursive: true });
    await fsp.rm(filePath, { recursive: true, force: true });
  }

  s.db.run(
    'INSERT INTO recycle_bin (id, original_path, name, kind, size, deleted_ms, storage_path) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, filePath, name, kind, size, now, storagePath],
  );

  return { id, originalPath: filePath, name, kind, size, deletedMs: now, storagePath };
}
