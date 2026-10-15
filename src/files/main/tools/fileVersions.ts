import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import { makeError } from '../../shared/errors';
import type { FileVersion } from '../../shared/fileVersions';
import { MAX_VERSIONS_DEFAULT } from '../../shared/fileVersions';
import type { Services } from '../services';

type Channels = 'version:list' | 'version:create' | 'version:delete' | 'version:restore' | 'version:diff' | 'version:setMax';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

function rowToVersion(row: Record<string, unknown>): FileVersion {
  return {
    id: row.id as string,
    filePath: row.file_path as string,
    versionNumber: row.version_number as number,
    sizeBytes: row.size_bytes as number,
    hash: row.hash as string,
    createdMs: row.created_ms as number,
    label: (row.label as string) || '',
  };
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function versionsDir(profileDir: string): string {
  return path.join(profileDir, 'file-versions');
}

function versionStoragePath(profileDir: string, versionId: string): string {
  return path.join(versionsDir(profileDir), versionId);
}

export function fileVersionHandlers(s: Services): Handlers {
  const vDir = versionsDir(s.profileDir);

  return {
    'version:list': (p) => {
      const rows = s.db.all<Record<string, unknown>>(
        'SELECT * FROM file_versions WHERE file_path = ? ORDER BY version_number DESC',
        [p.filePath],
      );
      return rows.map(rowToVersion);
    },

    'version:create': async (p) => {
      const filePath = p.filePath;
      const stat = await fsp.stat(filePath).catch(() => null);
      if (!stat || !stat.isFile()) throw makeError('not_found', 'version.create', { message: 'File not found or not a regular file.' });

      const hash = await hashFile(filePath);

      // Get next version number
      const last = s.db.get<Record<string, unknown>>(
        'SELECT MAX(version_number) as max_ver FROM file_versions WHERE file_path = ?',
        [filePath],
      );
      const nextVersion = ((last?.max_ver as number | null) ?? 0) + 1;

      const id = randomUUID().replace(/-/g, '').slice(0, 16);
      const now = Date.now();

      // Store the file content
      await fsp.mkdir(vDir, { recursive: true });
      await fsp.copyFile(filePath, versionStoragePath(s.profileDir, id));

      s.db.run(
        'INSERT INTO file_versions (id, file_path, version_number, size_bytes, hash, created_ms, label) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, filePath, nextVersion, stat.size, hash, now, p.label ?? ''],
      );

      // Enforce max versions
      const maxVersions = s.db.get<Record<string, unknown>>(
        'SELECT value FROM settings WHERE key = ?', ['maxFileVersions'],
      );
      const limit = maxVersions ? JSON.parse(maxVersions.value as string) as number : MAX_VERSIONS_DEFAULT;
      const old = s.db.all<Record<string, unknown>>(
        'SELECT id FROM file_versions WHERE file_path = ? ORDER BY version_number DESC LIMIT -1 OFFSET ?',
        [filePath, limit],
      );
      for (const o of old) {
        await fsp.unlink(versionStoragePath(s.profileDir, o.id as string)).catch(() => undefined);
        s.db.run('DELETE FROM file_versions WHERE id = ?', [o.id as string]);
      }

      return rowToVersion({ id, file_path: filePath, version_number: nextVersion, size_bytes: stat.size, hash, created_ms: now, label: p.label ?? '' });
    },

    'version:delete': async (p) => {
      const existing = s.db.get<Record<string, unknown>>('SELECT id FROM file_versions WHERE id = ?', [p.versionId]);
      if (!existing) throw makeError('not_found', 'version.delete', { message: 'Version not found.' });
      await fsp.unlink(versionStoragePath(s.profileDir, p.versionId)).catch(() => undefined);
      s.db.run('DELETE FROM file_versions WHERE id = ?', [p.versionId]);
      return { deleted: true };
    },

    'version:restore': async (p) => {
      const row = s.db.get<Record<string, unknown>>('SELECT * FROM file_versions WHERE id = ?', [p.versionId]);
      if (!row) throw makeError('not_found', 'version.restore', { message: 'Version not found.' });
      const storedPath = versionStoragePath(s.profileDir, p.versionId);
      const exists = await fsp.stat(storedPath).catch(() => null);
      if (!exists) throw makeError('not_found', 'version.restore', { message: 'Version storage file is missing.' });
      const filePath = row.file_path as string;
      await fsp.copyFile(storedPath, filePath);
      return { restored: true, filePath };
    },

    'version:diff': async (p) => {
      const rowA = s.db.get<Record<string, unknown>>('SELECT * FROM file_versions WHERE id = ?', [p.versionA]);
      const rowB = s.db.get<Record<string, unknown>>('SELECT * FROM file_versions WHERE id = ?', [p.versionB]);
      if (!rowA || !rowB) throw makeError('not_found', 'version.diff', { message: 'Version not found.' });
      const pathA = versionStoragePath(s.profileDir, p.versionA);
      const pathB = versionStoragePath(s.profileDir, p.versionB);
      const textA = await fsp.readFile(pathA, 'utf-8').catch(() => '');
      const textB = await fsp.readFile(pathB, 'utf-8').catch(() => '');
      // Simple line-based diff
      const linesA = textA.split('\n');
      const linesB = textB.split('\n');
      const hunks: Array<{ lineA: number; lineB: number; removed: string[]; added: string[] }> = [];
      let i = 0, j = 0;
      while (i < linesA.length || j < linesB.length) {
        if (i < linesA.length && j < linesB.length && linesA[i] === linesB[j]) {
          i++; j++; continue;
        }
        const removed: string[] = [];
        const added: string[] = [];
        const startA = i, startB = j;
        // Collect changed lines until we find a match again
        while (i < linesA.length && (j >= linesB.length || linesA[i] !== linesB[j])) {
          removed.push(linesA[i]!); i++;
        }
        while (j < linesB.length && (i >= linesA.length || linesA[i] !== linesB[j])) {
          added.push(linesB[j]!); j++;
        }
        if (removed.length || added.length) {
          hunks.push({ lineA: startA + 1, lineB: startB + 1, removed, added });
        }
      }
      return { hunks, versionA: rowToVersion(rowA), versionB: rowToVersion(rowB) };
    },

    'version:setMax': (p) => {
      s.db.run(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        ['maxFileVersions', JSON.stringify(p.max)],
      );
      return { max: p.max };
    },
  };
}
