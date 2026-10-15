import fsp from 'node:fs/promises';
import path from 'node:path';
import { makeError } from '../../shared/errors';
import { dHash, groupByHash, meanTone, type Bitmap, type SimilarGroup, type Tone } from '../../shared/similarity';
import type { JobGate } from '../jobs/PauseGate';

export type { Bitmap, SimilarGroup };

/** Decodes an image file and returns it resized to exactly 9×8 pixels, or undefined if this decoder cannot read the format. */
export type SmallImageDecoder = (p: string) => Promise<Bitmap | undefined>;

/**
 * Visually similar images, using a 64-bit difference hash (dHash): the image
 * is reduced to 9×8 greyscale pixels and each bit records whether a pixel is
 * brighter than its right-hand neighbour. Re-encoded, resized or lightly
 * edited copies have hashes a few bits apart; unrelated images differ in
 * about half of the bits. This is a similarity signal, not proof of identity,
 * and it never deletes anything.
 */

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'avif', 'heic']);

export interface SimilarResult {
  groups: SimilarGroup[];
  /** Every hash computed here (hex) with the image's average colour, so another decoder can add more and regroup. */
  hashes: Array<{ path: string; size: number; modifiedMs: number; hash: string; tone: Tone }>;
  /** Images this decoder could not read (other formats); the renderer may hash them. */
  pending: Array<{ path: string; size: number; modifiedMs: number }>;
  scanned: number;
  complete: boolean;
  threshold: number;
}


export async function findSimilarImages(
  roots: string[],
  decode: SmallImageDecoder,
  opts: { threshold?: number; maxImages?: number; signal: AbortSignal; onProgress?: (p: { scanned: number; hashed: number }) => void; gate?: JobGate },
): Promise<SimilarResult> {
  const threshold = Math.max(0, Math.min(20, opts.threshold ?? 8));
  const maxImages = opts.maxImages ?? 20000;
  const files: Array<{ path: string; size: number; modifiedMs: number }> = [];
  let complete = true;
  for (const root of roots) {
    const stack = [root];
    while (stack.length) {
      if (opts.gate?.isPaused) await opts.gate.wait();
      if (opts.signal.aborted) throw makeError('cancelled', 'tools.similar');
      const dir = stack.pop()!;
      for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile() && IMAGE_EXTS.has(path.extname(e.name).slice(1).toLowerCase())) {
          if (files.length >= maxImages) {
            complete = false;
            break;
          }
          const st = await fsp.lstat(p).catch(() => undefined);
          if (st?.isFile() && st.size > 0) files.push({ path: p, size: st.size, modifiedMs: st.mtimeMs });
        }
      }
    }
  }
  const hashed: Array<{ path: string; hash: bigint; size: number; modifiedMs: number; tone: Tone }> = [];
  const pending: SimilarResult['pending'] = [];
  let scanned = 0;
  for (const f of files) {
    if (opts.gate?.isPaused) await opts.gate.wait();
    if (opts.signal.aborted) throw makeError('cancelled', 'tools.similar');
    scanned++;
    try {
      const bmp = await decode(f.path);
      if (bmp) hashed.push({ ...f, hash: dHash(bmp), tone: meanTone(bmp) });
      else pending.push(f);
    } catch {
      pending.push(f);
    }
    if (scanned % 20 === 0) opts.onProgress?.({ scanned, hashed: hashed.length });
  }
  return {
    groups: groupByHash(hashed, threshold),
    hashes: hashed.map((h) => ({ path: h.path, size: h.size, modifiedMs: h.modifiedMs, hash: h.hash.toString(16).padStart(16, '0'), tone: h.tone })),
    pending,
    scanned,
    complete,
    threshold,
  };
}
