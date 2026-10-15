import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { diffLines } from 'diff';
import { looksBinary } from '../fs/FileSystemService';
import { makeError } from '../../shared/errors';
import type { DiffResult, DiffStats } from '../../shared/diff';

const DIFF_MAX = 5 * 1024 * 1024;
const HEX_PEEK = 4096;

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico', 'svg', 'tiff', 'tif']);

function hashBuffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/**
 * Compute a diff between two files. Automatically detects the file type:
 * - Text files: line-by-line diff with stats
 * - Image files: dimension and size comparison
 * - Binary files: hex dump comparison of first 4KB
 */
export async function computeDiff(pathA: string, pathB: string): Promise<DiffResult> {
  const [statA, statB] = await Promise.all([
    fsp.stat(pathA).catch((err) => { throw makeError('not_found', 'diff.compute', { target: pathA, message: (err as Error).message }); }),
    fsp.stat(pathB).catch((err) => { throw makeError('not_found', 'diff.compute', { target: pathB, message: (err as Error).message }); }),
  ]);

  if (!statA.isFile()) throw makeError('is_a_directory', 'diff.compute', { target: pathA });
  if (!statB.isFile()) throw makeError('is_a_directory', 'diff.compute', { target: pathB });

  const extA = extOf(path.basename(pathA));
  const extB = extOf(path.basename(pathB));

  // Image comparison
  if (IMAGE_EXTS.has(extA) && IMAGE_EXTS.has(extB)) {
    const [bufA, bufB] = await Promise.all([fsp.readFile(pathA), fsp.readFile(pathB)]);
    const leftHash = hashBuffer(bufA);
    const rightHash = hashBuffer(bufB);
    return {
      type: 'image',
      leftDims: null, // Dimensions are extracted in the renderer from the actual images
      rightDims: null,
      leftSize: statA.size,
      rightSize: statB.size,
      identical: leftHash === rightHash,
      leftHash,
      rightHash,
    };
  }

  // Try text comparison first
  if (statA.size <= DIFF_MAX && statB.size <= DIFF_MAX) {
    const [bufA, bufB] = await Promise.all([fsp.readFile(pathA), fsp.readFile(pathB)]);

    if (!looksBinary(bufA) && !looksBinary(bufB)) {
      const textA = bufA.toString('utf8');
      const textB = bufB.toString('utf8');
      const parts = diffLines(textA, textB);

      let added = 0;
      let removed = 0;
      let changed = 0;

      // Detect "changed" lines: a removed block followed by an added block
      const hunks = parts.map((p) => {
        const lines = p.value.replace(/\n$/, '').split('\n');
        if (p.added) added += lines.length;
        if (p.removed) removed += lines.length;
        return { kind: (p.added ? 'added' : p.removed ? 'removed' : 'same') as 'added' | 'removed' | 'same', lines };
      });

      // Count changed lines: pairs of removed+added hunks
      for (let i = 0; i < hunks.length - 1; i++) {
        if (hunks[i]!.kind === 'removed' && hunks[i + 1]!.kind === 'added') {
          const paired = Math.min(hunks[i]!.lines.length, hunks[i + 1]!.lines.length);
          changed += paired;
          added -= paired;
          removed -= paired;
        }
      }

      const stats: DiffStats = { linesAdded: added, linesRemoved: removed, linesChanged: changed };

      return {
        type: 'text',
        hunks,
        stats,
        identical: textA === textB,
        leftHash: hashBuffer(bufA),
        rightHash: hashBuffer(bufB),
      };
    }
  }

  // Binary comparison: hex dump of first 4KB
  const readHex = async (p: string, size: number): Promise<string> => {
    const bytes = Math.min(size, HEX_PEEK);
    const fh = await fsp.open(p, 'r');
    try {
      const buf = Buffer.alloc(bytes);
      await fh.read(buf, 0, bytes, 0);
      return buf.toString('base64');
    } finally {
      await fh.close();
    }
  };

  const [leftHex, rightHex] = await Promise.all([
    readHex(pathA, statA.size),
    readHex(pathB, statB.size),
  ]);

  // Full hash for identity check
  const hashFile = async (p: string): Promise<string> => {
    const h = crypto.createHash('sha256');
    const buf = await fsp.readFile(p);
    h.update(buf);
    return h.digest('hex');
  };

  const [leftHash, rightHash] = await Promise.all([hashFile(pathA), hashFile(pathB)]);

  return {
    type: 'binary',
    leftHex,
    rightHex,
    leftSize: statA.size,
    rightSize: statB.size,
    identical: leftHash === rightHash,
    leftHash,
    rightHash,
  };
}
