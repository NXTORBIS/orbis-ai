import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../shared/ipc';
import type { Services } from './services';
import { listVolumes } from './fs/volumes';
import type { DashboardData } from '../shared/dashboard';

type Channels = 'dashboard:data';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

export function dashboardHandlers(s: Services): Handlers {
  return {
    'dashboard:data': async (): Promise<DashboardData> => {
      const [recentsRaw, pinsRaw, volumes] = await Promise.all([
        Promise.resolve(s.catalog.recents(50)),
        Promise.resolve(s.catalog.pins()),
        listVolumes(),
      ]);
      const recents = recentsRaw.map((r) => ({
        path: r.path,
        name: r.path.split(/[\\/]/).filter(Boolean).pop() ?? r.path,
        kind: r.kind as 'file' | 'directory',
        lastMs: r.lastMs,
        exists: r.exists,
      }));
      const pinned = pinsRaw.map((p) => ({
        path: p.path,
        label: p.label,
      }));
      const drives = volumes.map((v) => ({
        name: v.label || v.mountPath,
        mountpoint: v.mountPath,
        totalBytes: v.totalBytes ?? 0,
        freeBytes: v.freeBytes ?? 0,
        fsType: v.fsType,
      }));
      return { recents, pinned, drives };
    },
  };
}
