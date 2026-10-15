import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import { makeError } from '../../shared/errors';
import { requireAbsolute } from '../fs/paths';
// openPath available from '../platform' if needed
import type { PauseGate } from '../jobs/PauseGate';
import type { S3Service } from './S3Service';

/**
 * IPC handlers for S3-compatible object storage. Payloads are validated by the
 * shared zod schemas before these run (ipcHandlers.ts); connection definitions
 * are validated again by S3Service. Nothing returned here contains a secret.
 */

type Channels = 's3:list' | 's3:save' | 's3:remove' | 's3:connect' | 's3:disconnect' | 's3:listBuckets' | 's3:listObjects' | 's3:mkdir' | 's3:delete' | 's3:rename' | 's3:presign' | 's3:download' | 's3:upload' | 's3:head';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };
type RunJob = <T>(jobId: string, wc: WebContents, fn: (signal: AbortSignal, progress: (p: unknown) => void, gate?: PauseGate) => Promise<T>, opts?: { pausable?: boolean }) => { jobId: string; pausable: boolean };

export function s3Handlers(s3: S3Service, runJob: RunJob, broadcast: (channel: 's3:changed', payload: unknown) => void): Handlers {
  s3.on('changed', () => broadcast('s3:changed', { connections: s3.list(), storage: s3.storage() }));
  return {
    's3:list': () => ({ connections: s3.list(), storage: s3.storage() }),

    's3:save': (p) => s3.save(p),

    's3:remove': (p) => {
      s3.remove(p.id);
      return { removed: true };
    },

    's3:connect': (p) => s3.connect(p.id, p.secret),

    's3:disconnect': (p) => {
      s3.disconnect(p.id);
      return { disconnected: true };
    },

    's3:listBuckets': async (p) => {
      const client = s3.client(p.id);
      return { buckets: await client.listBuckets() };
    },

    's3:listObjects': async (p) => {
      const client = s3.client(p.id);
      return client.listObjects(p.bucket, p.prefix, {
        continuationToken: p.continuationToken,
      });
    },

    's3:mkdir': async (p) => {
      const client = s3.client(p.id);
      await client.createFolder(p.bucket, p.prefix);
      return { created: true };
    },

    's3:delete': async (p) => {
      const client = s3.client(p.id);
      await client.deleteObject(p.bucket, p.key);
      return { deleted: true };
    },

    's3:rename': async (p) => {
      const client = s3.client(p.id);
      await client.renameObject(p.bucket, p.oldKey, p.newKey);
      return { renamed: true };
    },

    's3:presign': (p) => {
      const client = s3.client(p.id);
      return client.presignGetUrl(p.bucket, p.key, p.expiresIn);
    },

    's3:head': async (p) => {
      const client = s3.client(p.id);
      return client.headObject(p.bucket, p.key);
    },

    's3:download': (p, e) =>
      runJob(p.jobId, e.sender, async (signal, progress) => {
        const client = s3.client(p.id);
        const { stream, size, contentType } = await client.getObject(p.bucket, p.key, { signal });
        const name = p.key.split('/').pop() || 'download';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const tmpDir = path.join(require('os').tmpdir(), 'orbis-s3');
        await fsp.mkdir(tmpDir, { recursive: true });
        const tmpPath = path.join(tmpDir, `${Date.now()}-${name}`);
        const ws = fs.createWriteStream(tmpPath);
        let downloaded = 0;
        stream.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          progress({ done: downloaded, total: size });
        });
        await new Promise<void>((resolve, reject) => {
          stream.pipe(ws);
          ws.on('finish', resolve);
          ws.on('error', reject);
          stream.on('error', reject);
          if (signal.aborted) { ws.destroy(); reject(makeError('cancelled', 's3.download')); }
          signal.addEventListener('abort', () => { ws.destroy(); reject(makeError('cancelled', 's3.download')); }, { once: true });
        });
        return { localPath: tmpPath, size: downloaded, contentType };
      }, { pausable: false }),

    's3:upload': (p, e) =>
      runJob(p.jobId, e.sender, async (signal, progress) => {
        const client = s3.client(p.id);
        const localPath = requireAbsolute(p.localPath, 's3.upload');
        const stat = await fsp.stat(localPath);
        const data = await fsp.readFile(localPath);
        const result = await client.uploadFile(p.bucket, p.key, data, {
          signal,
          onProgress: (uploaded, total) => progress({ done: uploaded, total }),
        });
        return { etag: result.etag, size: stat.size };
      }, { pausable: false }),
  };
}
