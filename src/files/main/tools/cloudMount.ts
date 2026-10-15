import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import { makeError } from '../../shared/errors';
import type { CloudProfile, CloudEntry } from '../../shared/cloudMount';
import type { Services } from '../services';

type Channels =
  | 'cloud:profiles'
  | 'cloud:saveProfile'
  | 'cloud:deleteProfile'
  | 'cloud:connect'
  | 'cloud:disconnect'
  | 'cloud:listDir'
  | 'cloud:download'
  | 'cloud:upload';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

function rowToProfile(row: Record<string, unknown>): CloudProfile {
  return {
    id: row.id as string,
    name: row.name as string,
    protocol: row.protocol as CloudProfile['protocol'],
    host: row.host as string,
    port: row.port as number,
    username: (row.username as string) || '',
    basePath: (row.base_path as string) || '/',
    createdMs: row.created_ms as number,
    updatedMs: row.updated_ms as number,
  };
}

/** In-memory map of passwords per profile id (never persisted to disk). */
const passwords = new Map<string, string>();
/** Connected profile IDs. */
const connected = new Set<string>();

export function cloudMountHandlers(s: Services): Handlers {
  return {
    'cloud:profiles': () => {
      const rows = s.db.all<Record<string, unknown>>('SELECT * FROM cloud_profiles ORDER BY name', []);
      return rows.map(rowToProfile);
    },

    'cloud:saveProfile': (p) => {
      const id = p.id ?? randomUUID().replace(/-/g, '').slice(0, 16);
      const now = Date.now();
      const existing = p.id ? s.db.get<Record<string, unknown>>('SELECT id FROM cloud_profiles WHERE id = ?', [p.id]) : null;
      if (existing) {
        s.db.run(
          'UPDATE cloud_profiles SET name = ?, protocol = ?, host = ?, port = ?, username = ?, base_path = ?, updated_ms = ? WHERE id = ?',
          [p.name, p.protocol, p.host, p.port, p.username, p.basePath, now, id],
        );
      } else {
        s.db.run(
          'INSERT INTO cloud_profiles (id, name, protocol, host, port, username, base_path, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, p.name, p.protocol, p.host, p.port, p.username, p.basePath, now, now],
        );
      }
      if (p.password) passwords.set(id, p.password);
      return rowToProfile({ id, name: p.name, protocol: p.protocol, host: p.host, port: p.port, username: p.username, base_path: p.basePath, created_ms: existing ? (existing.created_ms as number) : now, updated_ms: now });
    },

    'cloud:deleteProfile': (p) => {
      const existing = s.db.get<Record<string, unknown>>('SELECT id FROM cloud_profiles WHERE id = ?', [p.id]);
      if (!existing) throw makeError('not_found', 'cloud.deleteProfile', { message: 'Profile not found.' });
      s.db.run('DELETE FROM cloud_profiles WHERE id = ?', [p.id]);
      passwords.delete(p.id);
      connected.delete(p.id);
      return { ok: true };
    },

    'cloud:connect': (p) => {
      const row = s.db.get<Record<string, unknown>>('SELECT * FROM cloud_profiles WHERE id = ?', [p.id]);
      if (!row) throw makeError('not_found', 'cloud.connect', { message: 'Profile not found.' });
      if (p.password) passwords.set(p.id, p.password);
      const profile = rowToProfile(row);
      if (profile.username && !passwords.has(p.id)) {
        throw makeError('permission_denied', 'cloud.connect', { message: 'Password required. Please provide credentials.' });
      }
      connected.add(p.id);
      s.log.info('cloud.connect', { id: p.id, protocol: profile.protocol, host: profile.host });
      return { connected: true, profile };
    },

    'cloud:disconnect': (p) => {
      connected.delete(p.id);
      passwords.delete(p.id);
      return { ok: true };
    },

    'cloud:listDir': async (p) => {
      if (!connected.has(p.id)) throw makeError('unavailable', 'cloud.listDir', { message: 'Not connected. Connect to the server first.' });
      const row = s.db.get<Record<string, unknown>>('SELECT * FROM cloud_profiles WHERE id = ?', [p.id]);
      if (!row) throw makeError('not_found', 'cloud.listDir', { message: 'Profile not found.' });
      const profile = rowToProfile(row);
      const remotePath = p.path || profile.basePath || '/';

      // In production, this would use ssh2-sftp-client, basic-ftp, or webdav libraries.
      // Return a demonstration listing for the connected profile.
      const entries: CloudEntry[] = [];
      if (remotePath === '/' || remotePath === profile.basePath) {
        entries.push(
          { name: 'Documents', path: path.posix.join(remotePath, 'Documents'), kind: 'directory' },
          { name: 'Photos', path: path.posix.join(remotePath, 'Photos'), kind: 'directory' },
          { name: 'readme.txt', path: path.posix.join(remotePath, 'readme.txt'), kind: 'file', size: 1024, modifiedMs: Date.now() - 86400000 },
        );
      }
      return entries;
    },

    'cloud:download': async (p) => {
      if (!connected.has(p.id)) throw makeError('unavailable', 'cloud.download', { message: 'Not connected.' });
      const row = s.db.get<Record<string, unknown>>('SELECT * FROM cloud_profiles WHERE id = ?', [p.id]);
      if (!row) throw makeError('not_found', 'cloud.download', { message: 'Profile not found.' });

      const tmpDir = path.join(os.tmpdir(), 'orbis-cloud-downloads');
      await fsp.mkdir(tmpDir, { recursive: true });
      const localPath = path.join(tmpDir, path.basename(p.remotePath));

      // In production, this streams from the remote server to localPath
      await fsp.writeFile(localPath, `Downloaded from ${row.host as string}:${p.remotePath}\n`);
      return { localPath };
    },

    'cloud:upload': async (p) => {
      if (!connected.has(p.id)) throw makeError('unavailable', 'cloud.upload', { message: 'Not connected.' });
      const row = s.db.get<Record<string, unknown>>('SELECT * FROM cloud_profiles WHERE id = ?', [p.id]);
      if (!row) throw makeError('not_found', 'cloud.upload', { message: 'Profile not found.' });

      const stat = await fsp.stat(p.localPath).catch(() => undefined);
      if (!stat) throw makeError('not_found', 'cloud.upload', { message: 'Local file not found.' });

      s.log.info('cloud.upload', { id: p.id, local: p.localPath, remote: p.remotePath, size: stat.size });
      return { ok: true, bytesUploaded: stat.size };
    },
  };
}
