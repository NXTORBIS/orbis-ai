// @ts-nocheck -- vendored Orbis Files code, checked by its own stricter-than-Orbis toolchain
import { opendir, stat } from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';

export interface DiffEntry {
  relativePath: string;
  status: 'added' | 'removed' | 'modified' | 'same';
  leftSize?: number;
  rightSize?: number;
  leftMtime?: number;
  rightMtime?: number;
  kind: 'file' | 'directory';
}

export interface DiffResult {
  leftPath: string;
  rightPath: string;
  entries: DiffEntry[];
  stats: {
    added: number;
    removed: number;
    modified: number;
    same: number;
    leftTotal: number;
    rightTotal: number;
    leftBytes: number;
    rightBytes: number;
  };
}

async function listRecursive(root: string, maxEntries: number, includeHidden = false): Promise<Map<string, { size: number; mtime: number; kind: 'file' | 'directory' }>> {
  const result = new Map<string, { size: number; mtime: number; kind: 'file' | 'directory' }>();
  const stack = [''];
  while (stack.length && result.size < maxEntries) {
    const rel = stack.pop()!;
    const abs = path.join(root, rel);
    let dir;
    try { dir = await opendir(abs); } catch { continue; }
    for await (const e of dir) {
      if (result.size >= maxEntries) break;
      if (!includeHidden && e.name.startsWith('.')) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      try {
        const st = await stat(path.join(root, relPath));
        const kind = st.isDirectory() ? 'directory' : 'file';
        result.set(relPath, { size: st.size, mtime: st.mtimeMs, kind });
        if (kind === 'directory') stack.push(relPath);
      } catch {}
    }
  }
  return result;
}

async function fileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const s = createReadStream(filePath, { highWaterMark: 65536 });
    s.on('data', d => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

export async function folderDiff(leftPath: string, rightPath: string, deep: boolean, compareContent: boolean, maxEntries: number): Promise<DiffResult> {
  const left = await listRecursive(leftPath, maxEntries);
  const right = await listRecursive(rightPath, maxEntries);

  const entries: DiffEntry[] = [];
  let added = 0, removed = 0, modified = 0, same = 0;
  let leftBytes = 0, rightBytes = 0;

  for (const [rel, info] of left) {
    leftBytes += info.size;
    const rInfo = right.get(rel);
    if (!rInfo) {
      entries.push({ relativePath: rel, status: 'removed', leftSize: info.size, leftMtime: info.mtime, kind: info.kind });
      removed++;
    } else if (info.kind !== rInfo.kind) {
      entries.push({ relativePath: rel, status: 'modified', leftSize: info.size, rightSize: rInfo.size, leftMtime: info.mtime, rightMtime: rInfo.mtime, kind: info.kind });
      modified++;
    } else if (info.kind === 'file') {
      let isDifferent = info.size !== rInfo.size || Math.abs(info.mtime - rInfo.mtime) > 1000;
      if (!isDifferent && compareContent && info.size === rInfo.size) {
        try {
          const lh = await fileHash(path.join(leftPath, rel));
          const rh = await fileHash(path.join(rightPath, rel));
          isDifferent = lh !== rh;
        } catch { isDifferent = true; }
      }
      if (isDifferent) {
        entries.push({ relativePath: rel, status: 'modified', leftSize: info.size, rightSize: rInfo.size, leftMtime: info.mtime, rightMtime: rInfo.mtime, kind: 'file' });
        modified++;
      } else {
        entries.push({ relativePath: rel, status: 'same', leftSize: info.size, rightSize: rInfo.size, kind: 'file' });
        same++;
      }
    } else {
      entries.push({ relativePath: rel, status: 'same', kind: 'directory' });
      same++;
    }
  }

  for (const [rel, info] of right) {
    rightBytes += info.size;
    if (!left.has(rel)) {
      entries.push({ relativePath: rel, status: 'added', rightSize: info.size, rightMtime: info.mtime, kind: info.kind });
      added++;
    }
  }

  entries.sort((a, b) => {
    const order = { removed: 0, added: 1, modified: 2, same: 3 };
    return order[a.status] - order[b.status] || a.relativePath.localeCompare(b.relativePath);
  });

  return {
    leftPath, rightPath, entries,
    stats: { added, removed, modified, same, leftTotal: left.size, rightTotal: right.size, leftBytes, rightBytes },
  };
}
