/**
 * Volume monitor main-process handler.
 * Lists mounted volumes with capacity info and supports eject/unmount.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { VolumeInfo, VolumesSnapshot } from '../shared/volumes';
import { usedPercent } from '../shared/volumes';
import { listVolumes } from './fs/volumes';
import { makeError } from '../shared/errors';

const execFileAsync = promisify(execFile);

/** Get all mounted volumes with detailed capacity info. */
export async function getVolumesSnapshot(): Promise<VolumesSnapshot> {
  const raw = await listVolumes();
  const volumes: VolumeInfo[] = raw.map((v) => {
    const total = v.totalBytes ?? 0;
    const free = v.freeBytes ?? 0;
    const used = Math.max(0, total - free);
    return {
      id: v.id,
      label: v.label,
      mountPath: v.mountPath,
      fsType: v.fsType,
      totalBytes: total,
      usedBytes: used,
      freeBytes: free,
      removable: v.removable ?? false,
      usedPercent: usedPercent(total, free),
      source: v.source,
    };
  });
  return { volumes, timestampMs: Date.now() };
}

/** Attempt to eject/unmount a volume. */
export async function ejectVolume(mountPath: string): Promise<{ success: boolean; message: string }> {
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      await execFileAsync('diskutil', ['eject', mountPath]);
      return { success: true, message: `Ejected ${mountPath}` };
    } else if (platform === 'linux') {
      // Try udisksctl first, then umount
      try {
        await execFileAsync('udisksctl', ['unmount', '-b', mountPath]);
        return { success: true, message: `Unmounted ${mountPath}` };
      } catch {
        await execFileAsync('umount', [mountPath]);
        return { success: true, message: `Unmounted ${mountPath}` };
      }
    } else if (platform === 'win32') {
      // Windows: use mountvol to unmount
      await execFileAsync('mountvol', [mountPath, '/p']);
        return { success: true, message: `Ejected ${mountPath}` };
    } else {
      throw new Error(`Eject is not supported on ${platform}`);
    }
  } catch (err) {
    const msg = (err as Error).message || 'Unknown error';
    return { success: false, message: `Could not eject ${mountPath}: ${msg}` };
  }
}

/** IPC handlers for the volume monitor. */
export function volumeMonitorHandlers() {
  return {
    'volumes:snapshot': () => getVolumesSnapshot(),
    'volumes:eject': (p: { mountPath: string }) => {
      if (!p.mountPath) throw makeError('validation', 'volumes.eject', { message: 'Mount path is required.' });
      return ejectVolume(p.mountPath);
    },
  } as const;
}
