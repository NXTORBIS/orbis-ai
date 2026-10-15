import path from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../shared/ipc';
import { makeError } from '../shared/errors';
import type { DownloadService } from './download/DownloadService';
import type { DownloadSettings } from '../shared/downloads';

type Channels = 'download:start' | 'download:pause' | 'download:resume' | 'download:cancel' | 'download:retry' | 'download:remove' | 'download:list' | 'download:clearHistory' | 'download:settings';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

/**
 * IPC handlers for the download manager. Called from registerIpc().
 */
export function downloadHandlers(dl: DownloadService): Handlers {
  return {
    'download:start': async (p) => {
      if (!path.isAbsolute(p.destination)) throw makeError('invalid_name', 'download.start', { message: 'Destination must be an absolute path.' });
      return dl.start(p.url, p.destination, p.options ?? undefined);
    },
    'download:pause': (p) => {
      const rec = dl.pause(p.id);
      if (!rec) throw makeError('not_found', 'download.pause', { message: 'Download not found or not pausable.' });
      return rec;
    },
    'download:resume': (p) => {
      const rec = dl.resume(p.id);
      if (!rec) throw makeError('not_found', 'download.resume', { message: 'Download not found or not resumable.' });
      return rec;
    },
    'download:cancel': (p) => {
      const rec = dl.cancel(p.id);
      if (!rec) throw makeError('not_found', 'download.cancel', { message: 'Download not found.' });
      return rec;
    },
    'download:retry': (p) => {
      const rec = dl.retry(p.id);
      if (!rec) throw makeError('not_found', 'download.retry', { message: 'Download not found or not retriable.' });
      return rec;
    },
    'download:remove': (p) => {
      if (!dl.remove(p.id)) throw makeError('not_found', 'download.remove', { message: 'Download not found.' });
      return { ok: true };
    },
    'download:list': (p) => {
      return dl.list(p.filter ?? 'all');
    },
    'download:clearHistory': () => {
      const removed = dl.clearHistory();
      return { removed };
    },
    'download:settings': (p): DownloadSettings => {
      if (p.update) return dl.updateSettings(p.update);
      return dl.getSettings();
    },
  };
}
