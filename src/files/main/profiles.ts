import fsp from 'node:fs/promises';
import path from 'node:path';
import { makeError, OrbisError, toOrbisError } from '../shared/errors';
import { ProfileIdSchema } from '../shared/integration/host-contract';
import { TERMINAL_STATES, type OperationRecord } from '../shared/operations';

/**
 * Local profiles. Each profile is a folder `userData/profiles/<id>` holding its
 * own database, thumbnails and snapshots; the folder name is the profile id.
 * Only one profile runs at a time (the single-instance lock covers userData),
 * so a profile other than the current one is never in use.
 */

export interface ProfileInfo {
  id: string;
  current: boolean;
  /** When the profile's database was last written (an approximation of "last used"). */
  lastUsedMs?: number;
  /** Bytes stored in the profile folder; `sizeComplete` is false when the count stopped early. */
  sizeBytes: number;
  sizeComplete: boolean;
}

const DB_FILE = 'orbis-files.db';
const MAX_SIZE_ENTRIES = 20000;

export function checkProfileId(id: unknown, operation: string): string {
  const r = ProfileIdSchema.safeParse(id);
  if (!r.success) throw makeError('invalid_name', operation, { message: r.error.issues[0]?.message ?? 'Not a valid profile name.' });
  return r.data;
}

/** Folder size, bounded so a profile with many snapshots never stalls the list. */
async function folderSize(dir: string): Promise<{ bytes: number; complete: boolean }> {
  let bytes = 0;
  let seen = 0;
  const queue = [dir];
  while (queue.length) {
    const d = queue.shift()!;
    const entries = await fsp.readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (++seen > MAX_SIZE_ENTRIES) return { bytes, complete: false };
      const p = path.join(d, e.name);
      if (e.isDirectory()) queue.push(p);
      else if (e.isFile()) bytes += (await fsp.stat(p).catch(() => undefined))?.size ?? 0;
    }
  }
  return { bytes, complete: true };
}

export async function listProfiles(root: string, current: string): Promise<ProfileInfo[]> {
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  const ids = entries.filter((e) => e.isDirectory() && ProfileIdSchema.safeParse(e.name).success).map((e) => e.name);
  if (!ids.includes(current)) ids.push(current);
  const list = await Promise.all(ids.map(async (id): Promise<ProfileInfo> => {
    const dir = path.join(root, id);
    const db = await fsp.stat(path.join(dir, DB_FILE)).catch(() => undefined);
    const size = await folderSize(dir);
    return { id, current: id === current, lastUsedMs: db?.mtimeMs, sizeBytes: size.bytes, sizeComplete: size.complete };
  }));
  return list.sort((a, b) => Number(b.current) - Number(a.current) || (b.lastUsedMs ?? 0) - (a.lastUsedMs ?? 0) || a.id.localeCompare(b.id));
}

/** Creates an empty profile folder; Orbis Files sets up its data the first time it starts on it. */
export async function createProfile(root: string, rawId: unknown): Promise<string> {
  const id = checkProfileId(rawId, 'profile.create');
  const existing = await fsp.readdir(root).catch(() => [] as string[]);
  // Compared without case: on Windows and macOS "Work" and "work" are the same folder.
  if (existing.some((n) => n.toLowerCase() === id.toLowerCase())) throw makeError('already_exists', 'profile.create', { message: `A profile named “${id}” already exists.` });
  await fsp.mkdir(root, { recursive: true });
  await fsp.mkdir(path.join(root, id)).catch((err) => {
    throw new OrbisError(toOrbisError(err, 'profile.create', undefined, 'no'));
  });
  return id;
}

/**
 * Moves a profile folder to the Trash. The profile in use is refused, and the
 * caller must pass the profile name typed by the user as confirmation.
 */
export async function deleteProfile(root: string, rawId: unknown, current: string, typed: string, trash: (p: string) => Promise<void>): Promise<void> {
  const id = checkProfileId(rawId, 'profile.delete');
  if (id === current) throw makeError('busy', 'profile.delete', { message: 'The profile in use cannot be deleted. Switch to another profile first.' });
  if (typed !== id) throw makeError('validation', 'profile.delete', { message: 'Type the profile name exactly to confirm.' });
  const dir = path.resolve(root, id);
  if (path.dirname(dir) !== path.resolve(root)) throw makeError('invalid_path', 'profile.delete');
  const st = await fsp.lstat(dir).catch(() => undefined);
  if (!st) throw makeError('not_found', 'profile.delete', { message: `There is no profile named “${id}”.` });
  if (st.isSymbolicLink() || !st.isDirectory()) throw makeError('unsupported', 'profile.delete', { message: 'This profile entry is not a plain folder and was not removed.' });
  await trash(dir).catch((err) => {
    throw makeError('unavailable', 'profile.delete', { message: `The profile could not be moved to the Trash: ${(err as Error).message}` });
  });
}

/** Operations that would be cut off by a restart. */
export function activeOperations(ops: OperationRecord[]): OperationRecord[] {
  return ops.filter((r) => !TERMINAL_STATES.has(r.state));
}

/** Refuses a switch while file operations run (the restart would cancel them). */
export function checkCanSwitch(ops: OperationRecord[], target: string, operation: string): void {
  const n = activeOperations(ops).length;
  if (n) throw makeError('busy', operation, { message: `Switching to profile “${target}” was refused because ${n} file operation${n === 1 ? ' is' : 's are'} running. Try again when ${n === 1 ? 'it finishes' : 'they finish'}.`, retryable: true });
}

/** Command-line arguments for relaunching on another profile (drops a previous profile and any one-off host request). */
export function relaunchArgs(argv: readonly string[], target: string): string[] {
  return [...argv.slice(1).filter((a) => !a.startsWith('--orbis-profile=') && !a.startsWith('--orbis-request=')), `--orbis-profile=${target}`];
}
