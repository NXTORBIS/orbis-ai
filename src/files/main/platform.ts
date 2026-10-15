import { app, shell } from 'electron';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { KnownLocation, PlatformCapabilities } from '../shared/model';
import { makeError } from '../shared/errors';
import type { PlatformOps } from './ops/OperationManager';
import { trashForCurrentUser, type TrashStore } from './fs/trash';
import { listVolumes } from './fs/volumes';

/**
 * Electron-backed platform adapter. Every capability is detected and reported;
 * nothing is assumed to exist because a button does.
 */

/**
 * The system Trash as a browsable store: Linux only, where the freedesktop.org
 * Trash specification defines where items and their original locations are kept.
 * macOS and Windows keep that information in formats Orbis Files does not read.
 */
export const systemTrash: TrashStore | undefined = process.platform === 'linux' ? trashForCurrentUser(async () => (await listVolumes('linux')).map((v) => v.mountPath)) : undefined;

/** What the system calls its Trash and where the user restores from it. */
export function systemTrashName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'Recycle Bin' : 'Trash';
}

export const electronPlatformOps: PlatformOps = {
  trashSupported: true,
  async trash(p: string): Promise<void> {
    await shell.trashItem(p);
  },
  locateTrashed: systemTrash ? (p, since) => systemTrash.locate(p, since) : undefined,
  trashRestoreHint:
    process.platform === 'darwin'
      ? 'Restore them from the Trash in Finder (Put Back).'
      : process.platform === 'win32'
        ? 'Restore them from the Recycle Bin.'
        : 'Restore them from the Trash view.',
};

/**
 * Open the system Trash in the operating system's file manager, where that can
 * really be done: Finder (macOS, ~/.Trash) or File Explorer (Windows, the
 * Recycle Bin shell folder). Linux has the Trash view instead.
 */
export function canOpenSystemTrash(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin' || platform === 'win32';
}

export async function openSystemTrash(): Promise<void> {
  if (process.platform === 'darwin') {
    const err = await shell.openPath(path.join(os.homedir(), '.Trash'));
    if (err) throw makeError('unavailable', 'trash.openSystem', { message: `The Trash could not be opened in Finder: ${err}` });
    return;
  }
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('explorer.exe', ['shell:RecycleBinFolder'], { detached: true, stdio: 'ignore', windowsHide: false });
      child.once('error', (e) => reject(makeError('unavailable', 'trash.openSystem', { message: `The Recycle Bin could not be opened: ${e.message}` })));
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
    return;
  }
  throw makeError('unsupported', 'trash.openSystem', { message: 'Use the Trash view to browse the Trash on this system.' });
}

import { isOrbisOnly } from './orbisScope';

let locationsOverride: KnownLocation[] | null = null;

/** Orbis Files shows its own folders instead of the system's Desktop, Documents and the rest. */
export function setKnownLocations(list: KnownLocation[]): void {
  locationsOverride = list;
}

export async function knownLocations(): Promise<KnownLocation[]> {
  if (locationsOverride && isOrbisOnly()) return locationsOverride;
  const ids: Array<[KnownLocation['id'], Parameters<typeof app.getPath>[0], string]> = [
    ['home', 'home', 'Home'],
    ['desktop', 'desktop', 'Desktop'],
    ['documents', 'documents', 'Documents'],
    ['downloads', 'downloads', 'Downloads'],
    ['pictures', 'pictures', 'Pictures'],
    ['videos', 'videos', 'Videos'],
    ['music', 'music', 'Music'],
  ];
  const out: KnownLocation[] = [];
  for (const [id, key, label] of ids) {
    let p: string;
    try {
      p = app.getPath(key);
    } catch {
      continue;
    }
    // On Linux, unset XDG user dirs resolve to $HOME itself. In that case use the
    // conventional folder (e.g. ~/Documents) only if it really exists.
    if (id !== 'home' && path.resolve(p) === path.resolve(os.homedir())) {
      p = path.join(os.homedir(), label);
    }
    // Only show locations that actually exist and are directories.
    const st = await fsp.stat(p).catch(() => undefined);
    if (!st?.isDirectory()) continue;
    out.push({ id, label, path: p });
  }
  return out;
}

export async function detectCapabilities(): Promise<PlatformCapabilities> {
  const platform = process.platform;
  const notes: string[] = [];
  const caseSensitivePaths = await probeCaseSensitivity();
  if (platform === 'linux') {
    notes.push('Trash uses the freedesktop.org Trash specification via Electron (gio/kioclient, or ~/.local/share/Trash). The Trash view lists, restores and permanently deletes items in the home Trash and the Trash folders of mounted drives, and a move to the Trash can be undone.');
  } else {
    notes.push(`Moving to the ${systemTrashName(platform)} uses the system's own ${systemTrashName(platform)}. Browsing it and undoing a move to it are available on Linux only; restore items from the ${systemTrashName(platform)} in the system file manager.`);
  }
  if (platform === 'linux') {
    notes.push('Change notifications: the open folder is watched directly; indexed folders are watched folder by folder (up to 4,000 folders per indexed root), with periodic re-checks for the rest.');
  }
  return {
    platform,
    trash: true,
    revealInFileManager: true,
    openWithDefaultApp: true,
    symlinkCreate: platform !== 'win32',
    symlinkInspect: true,
    volumeEnumeration: platform === 'linux' || platform === 'darwin' || platform === 'win32',
    watch: 'recursive',
    caseSensitivePaths,
    atomicRename: true,
    posixPermissions: platform !== 'win32',
    notes,
  };
}

async function probeCaseSensitivity(): Promise<boolean> {
  const dir = app.getPath('temp');
  const name = `OrbisCaseProbe-${process.pid}`;
  const p = path.join(dir, name);
  try {
    await fsp.writeFile(p, '');
    const lower = await fsp.stat(path.join(dir, name.toLowerCase())).then(() => true, () => false);
    return !lower;
  } catch {
    return process.platform === 'linux';
  } finally {
    await fsp.unlink(p).catch(() => undefined);
  }
}

export { executableReason } from './fs/executable';

export async function openPath(p: string): Promise<void> {
  const error = await shell.openPath(p);
  if (error) throw makeError('unavailable', 'fs.open', { message: `No application could open this item: ${error}`, target: p });
}

export function reveal(p: string): void {
  shell.showItemInFolder(p);
}
