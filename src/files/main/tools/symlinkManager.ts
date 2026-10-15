import fsp from 'node:fs/promises';
import path from 'node:path';
import { makeError, toOrbisError, OrbisError } from '../../shared/errors';
import type { SymlinkInfo } from '../../shared/symlinks';

/** Scan a directory for symlinks. */
export async function scanSymlinks(dir: string, recursive: boolean): Promise<SymlinkInfo[]> {
  const results: SymlinkInfo[] = [];
  const visit = async (d: string): Promise<void> => {
    let entries;
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      const st = await fsp.lstat(full).catch(() => undefined);
      if (!st) continue;
      if (st.isSymbolicLink()) {
        const raw = await fsp.readlink(full).catch(() => '');
        const isRelative = !path.isAbsolute(raw);
        let exists = false;
        let kind: SymlinkInfo['kind'] = 'broken';
        try {
          const target = await fsp.stat(full);
          exists = true;
          kind = target.isDirectory() ? 'dir' : 'file';
        } catch {
          // broken link
        }
        results.push({ path: full, target: raw, exists, isRelative, kind });
      } else if (recursive && st.isDirectory()) {
        await visit(full);
      }
    }
  };
  await visit(dir);
  return results;
}

/** Create a new symlink. */
export async function createSymlink(linkPath: string, target: string, relative: boolean): Promise<SymlinkInfo> {
  const dir = path.dirname(linkPath);
  const effectiveTarget = relative ? path.relative(dir, target) : target;
  await fsp.symlink(effectiveTarget, linkPath).catch((err) => {
    throw new OrbisError(toOrbisError(err, 'symlink.create', linkPath, 'no'));
  });
  // stat the result
  let exists = false;
  let kind: SymlinkInfo['kind'] = 'broken';
  try {
    const st = await fsp.stat(linkPath);
    exists = true;
    kind = st.isDirectory() ? 'dir' : 'file';
  } catch { /* broken */ }
  return { path: linkPath, target: effectiveTarget, exists, isRelative: relative, kind };
}

/** Re-point a symlink to a new target. */
export async function retargetSymlink(linkPath: string, newTarget: string): Promise<SymlinkInfo> {
  const st = await fsp.lstat(linkPath).catch((err) => {
    throw new OrbisError(toOrbisError(err, 'symlink.retarget', linkPath, 'no'));
  });
  if (!st.isSymbolicLink()) throw makeError('validation', 'symlink.retarget', { message: 'Not a symbolic link.' });
  await fsp.unlink(linkPath);
  await fsp.symlink(newTarget, linkPath).catch((err) => {
    throw new OrbisError(toOrbisError(err, 'symlink.retarget', linkPath, 'no'));
  });
  let exists = false;
  let kind: SymlinkInfo['kind'] = 'broken';
  try {
    const resolved = await fsp.stat(linkPath);
    exists = true;
    kind = resolved.isDirectory() ? 'dir' : 'file';
  } catch { /* broken */ }
  const isRelative = !path.isAbsolute(newTarget);
  return { path: linkPath, target: newTarget, exists, isRelative, kind };
}

/** Delete a symlink (unlinks the link, not its target). */
export async function deleteSymlink(linkPath: string): Promise<void> {
  const st = await fsp.lstat(linkPath).catch((err) => {
    throw new OrbisError(toOrbisError(err, 'symlink.delete', linkPath, 'no'));
  });
  if (!st.isSymbolicLink()) throw makeError('validation', 'symlink.delete', { message: 'Not a symbolic link.' });
  await fsp.unlink(linkPath);
}

/** Fix a broken symlink by re-pointing it. */
export async function fixBrokenSymlink(linkPath: string, newTarget: string): Promise<SymlinkInfo> {
  return retargetSymlink(linkPath, newTarget);
}

/** Convert a symlink between absolute and relative. */
export async function convertSymlink(linkPath: string, toRelative: boolean): Promise<SymlinkInfo> {
  const st = await fsp.lstat(linkPath).catch((err) => {
    throw new OrbisError(toOrbisError(err, 'symlink.convert', linkPath, 'no'));
  });
  if (!st.isSymbolicLink()) throw makeError('validation', 'symlink.convert', { message: 'Not a symbolic link.' });
  const raw = await fsp.readlink(linkPath);
  const dir = path.dirname(linkPath);
  let newTarget: string;
  if (toRelative) {
    const abs = path.isAbsolute(raw) ? raw : path.resolve(dir, raw);
    newTarget = path.relative(dir, abs);
  } else {
    newTarget = path.isAbsolute(raw) ? raw : path.resolve(dir, raw);
  }
  await fsp.unlink(linkPath);
  await fsp.symlink(newTarget, linkPath);
  let exists = false;
  let kind: SymlinkInfo['kind'] = 'broken';
  try {
    const resolved = await fsp.stat(linkPath);
    exists = true;
    kind = resolved.isDirectory() ? 'dir' : 'file';
  } catch { /* broken */ }
  return { path: linkPath, target: newTarget, exists, isRelative: toRelative, kind };
}
