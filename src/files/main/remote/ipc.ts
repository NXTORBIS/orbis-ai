import type { IpcMainInvokeEvent, WebContents } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import { makeError } from '../../shared/errors';
import { executableReason, openPath } from '../platform';
import { requireAbsolute } from '../fs/paths';
import { statPath } from '../fs/FileSystemService';
import type { PauseGate } from '../jobs/PauseGate';
import type { Services } from '../services';

/**
 * IPC handlers for remote locations. Payloads are validated by the shared zod
 * schemas before these run (ipcHandlers.ts); connection definitions are
 * validated again by RemoteService. Nothing returned here contains a secret.
 */

type Channels = 'remote:list' | 'remote:save' | 'remote:remove' | 'remote:connect' | 'remote:trustHostKey' | 'remote:forgetHostKey' | 'remote:disconnect' | 'remote:listDir' | 'remote:stat' | 'remote:mkdir' | 'remote:rename' | 'remote:open' | 'remote:preview' | 'remote:opened' | 'remote:discardCopy';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };
type RunJob = <T>(jobId: string, wc: WebContents, fn: (signal: AbortSignal, progress: (p: unknown) => void, gate?: PauseGate) => Promise<T>, opts?: { pausable?: boolean }) => { jobId: string; pausable: boolean };

export function remoteHandlers(s: Services, runJob: RunJob, broadcast: (channel: 'remote:changed' | 'remote:opened', payload: unknown) => void): Handlers {
  const r = s.remote;
  r.on('changed', () => broadcast('remote:changed', { connections: r.list(), storage: r.storage() }));
  r.on('opened', (list) => broadcast('remote:opened', list));
  return {
    'remote:list': () => ({ connections: r.list(), storage: r.storage(), opened: r.openedCopies() }),
    'remote:save': (p) => r.save(p),
    'remote:remove': (p) => {
      r.remove(p.id);
      return { removed: true };
    },
    'remote:connect': (p) => r.connect(p.id, p.secret),
    'remote:trustHostKey': (p) => r.trustHostKey(p.id, p.fingerprint),
    'remote:forgetHostKey': (p) => {
      r.forgetHostKey(p.id);
      return r.get(p.id);
    },
    'remote:disconnect': (p) => {
      if (p.forgetPassword) r.forgetSession(p.id);
      else r.disconnect(p.id);
      return { disconnected: true };
    },
    'remote:listDir': (p) => r.listDir(p.id, p.path, p.showHidden),
    'remote:stat': (p) => r.stat(p.ref),
    'remote:mkdir': (p) => r.mkdir(p.id, p.parent, p.name),
    'remote:rename': (p) => r.rename(p.ref, p.newName),
    'remote:open': (p, e) =>
      runJob(p.jobId, e.sender, async (signal, progress) => {
        const localPath = await r.openCopy(p.ref, signal, (done, total) => progress({ done, total }));
        // The copy is opened like any file: programs and scripts need the separate confirmation.
        const reason = await executableReason(localPath);
        if (reason) return { localPath, opened: false, needsConfirmation: true, reason };
        await openPath(localPath);
        return { localPath, opened: true };
      }, { pausable: false }),
    'remote:preview': (p, e) =>
      runJob(p.jobId, e.sender, async (signal) => statPath(await r.previewCopy(p.ref, signal)), { pausable: false }),
    'remote:opened': () => r.openedCopies(),
    'remote:discardCopy': async (p) => {
      const local = requireAbsolute(p.localPath, 'remote.discardCopy');
      if (!r.openedCopy(local)) throw makeError('not_found', 'remote.discardCopy', { message: 'This copy is no longer tracked.' });
      await r.discardCopy(local);
      return { discarded: true };
    },
  };
}
