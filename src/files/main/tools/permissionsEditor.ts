import fsp from 'node:fs/promises';
import path from 'node:path';
import { makeError } from '../../shared/errors';

export interface PermissionInfo {
  mode: number;
  owner: string;
  group: string;
  uid: number;
  gid: number;
  size: number;
  links: number;
  inode: number;
  type: 'file' | 'directory' | 'symlink' | 'other';
}

export async function getPermissions(filePath: string): Promise<PermissionInfo> {
  const stat = await fsp.stat(filePath);

  let owner = String(stat.uid);
  let group = String(stat.gid);

  // Try to resolve names (Linux only, best effort)
  try {
    const { ownerNames: resolveOwnerNames } = await import('../fs/owners');
    const names = resolveOwnerNames([stat.uid], [stat.gid]);
    owner = names.users[stat.uid] ?? owner;
    group = names.groups[stat.gid] ?? group;
  } catch {
    // leave as numeric
  }

  const type = stat.isFile() ? 'file' as const
    : stat.isDirectory() ? 'directory' as const
    : stat.isSymbolicLink() ? 'symlink' as const
    : 'other' as const;

  return {
    mode: stat.mode & 0o7777,
    owner,
    group,
    uid: stat.uid,
    gid: stat.gid,
    size: stat.size,
    links: stat.nlink,
    inode: stat.ino,
    type,
  };
}

export async function setPermissions(filePath: string, mode: number): Promise<void> {
  if (mode < 0 || mode > 0o7777) throw makeError('validation', `Invalid permission mode: ${mode.toString(8)}`);
  await fsp.chmod(filePath, mode);
}

export async function changeOwner(filePath: string, uid: number, gid: number): Promise<void> {
  await fsp.chown(filePath, uid, gid);
}

export async function setPermissionsRecursive(dirPath: string, mode: number, signal?: AbortSignal): Promise<number> {
  let count = 0;
  const stat = await fsp.stat(dirPath);
  if (!stat.isDirectory()) {
    await fsp.chmod(dirPath, mode);
    return 1;
  }

  await fsp.chmod(dirPath, mode);
  count++;

  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (signal?.aborted) break;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      count += await setPermissionsRecursive(fullPath, mode, signal);
    } else {
      await fsp.chmod(fullPath, mode);
      count++;
    }
  }
  return count;
}
