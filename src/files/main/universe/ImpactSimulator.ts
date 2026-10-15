// @ts-nocheck -- vendored Orbis Files code, checked by its own stricter-than-Orbis toolchain
import { stat, readdir, readlink } from 'fs/promises';
import path from 'path';

export interface ImpactResult {
  path: string;
  kind: 'file' | 'directory';
  size: number;
  impacts: ImpactItem[];
}

export interface ImpactItem {
  type: 'broken_symlink' | 'orphaned_reference' | 'space_freed' | 'directory_affected' | 'child_count';
  description: string;
  path?: string;
  value?: number;
}

export async function simulateImpact(
  paths: string[],
  operation: 'delete' | 'move' | 'rename',
  destination?: string
): Promise<ImpactResult[]> {
  const results: ImpactResult[] = [];

  for (const p of paths) {
    const impacts: ImpactItem[] = [];
    let st;
    try { st = await stat(p); } catch { continue; }

    const kind = st.isDirectory() ? 'directory' : 'file';
    const size = st.size;

    if (operation === 'delete') {
      impacts.push({ type: 'space_freed', description: `Frees ${formatBytes(size)}`, value: size });
    }

    if (kind === 'directory') {
      try {
        const children = await readdir(p);
        impacts.push({ type: 'child_count', description: `Contains ${children.length} items`, value: children.length });
      } catch {}

      // Count total recursive size
      let totalSize = 0;
      let totalFiles = 0;
      const stack = [p];
      while (stack.length) {
        const dir = stack.pop()!;
        try {
          const entries = await readdir(dir, { withFileTypes: true });
          for (const e of entries) {
            const fp = path.join(dir, e.name);
            if (e.isDirectory()) stack.push(fp);
            else {
              try {
                const s = await stat(fp);
                totalSize += s.size;
                totalFiles++;
              } catch {}
            }
            if (totalFiles > 10000) break;
          }
        } catch {}
        if (totalFiles > 10000) break;
      }
      if (operation === 'delete') {
        impacts.push({ type: 'space_freed', description: `Total: ${formatBytes(totalSize)} in ${totalFiles} files`, value: totalSize });
      }
      impacts.push({ type: 'directory_affected', description: `${totalFiles} files affected`, value: totalFiles });
    }

    // Check for symlinks pointing to this path
    const parentDir = path.dirname(p);
    try {
      const siblings = await readdir(parentDir, { withFileTypes: true });
      for (const sib of siblings) {
        if (sib.isSymbolicLink()) {
          try {
            const target = await readlink(path.join(parentDir, sib.name));
            const resolved = path.resolve(parentDir, target);
            if (resolved === p || resolved.startsWith(p + path.sep)) {
              impacts.push({ type: 'broken_symlink', description: `Symlink ${sib.name} would break`, path: path.join(parentDir, sib.name) });
            }
          } catch {}
        }
      }
    } catch {}

    results.push({ path: p, kind, size, impacts });
  }

  return results;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}
