/**
 * Disk usage scanner: recursively walks a directory tree computing sizes.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { DiskNode, DiskScanProgress, DiskScanResult } from '../../shared/diskUsage';
import type { PauseGate } from '../jobs/PauseGate';

const MAX_LARGEST = 50;

export async function scanDiskUsage(
  root: string,
  signal: AbortSignal,
  onProgress: (p: DiskScanProgress) => void,
  gate?: PauseGate,
  opts?: { maxDepth?: number },
): Promise<DiskScanResult> {
  const maxDepth = opts?.maxDepth ?? 32;
  const startMs = Date.now();
  let totalFiles = 0;
  let totalDirs = 0;
  const largest: Array<{ path: string; size: number }> = [];

  function insertLargest(filePath: string, size: number): void {
    if (largest.length < MAX_LARGEST || size > (largest[largest.length - 1]?.size ?? 0)) {
      largest.push({ path: filePath, size });
      largest.sort((a, b) => b.size - a.size);
      if (largest.length > MAX_LARGEST) largest.length = MAX_LARGEST;
    }
  }

  async function walk(dir: string, depth: number): Promise<DiskNode> {
    if (signal.aborted) throw new Error('Cancelled');
    await gate?.wait();

    let entries: import('node:fs').Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return { name: path.basename(dir), path: dir, size: 0, fileCount: 0 };
    }

    let size = 0;
    let fileCount = 0;
    const children: DiskNode[] = [];

    for (const ent of entries) {
      if (signal.aborted) throw new Error('Cancelled');
      await gate?.wait();

      const fullPath = path.join(dir, ent.name);

      if (ent.isDirectory()) {
        totalDirs++;
        if (depth < maxDepth) {
          const child = await walk(fullPath, depth + 1);
          children.push(child);
          size += child.size;
          fileCount += child.fileCount;
        }
      } else if (ent.isFile()) {
        try {
          const st = await fsp.stat(fullPath);
          size += st.size;
          fileCount++;
          totalFiles++;
          insertLargest(fullPath, st.size);
          onProgress({ files: totalFiles, dirs: totalDirs, bytes: size, current: fullPath });
        } catch {
          // skip unreadable files
        }
      }
    }

    // Sort children by size descending
    children.sort((a, b) => b.size - a.size);

    return { name: path.basename(dir), path: dir, size, fileCount, children: children.length ? children : undefined };
  }

  const tree = await walk(root, 0);
  return {
    root,
    tree,
    totalSize: tree.size,
    totalFiles,
    totalDirs,
    largestFiles: largest,
    scannedMs: Date.now() - startMs,
  };
}
