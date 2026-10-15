/**
 * Content-defined chunking and a content-addressed store.
 *
 * Fixed-size blocks break every boundary downstream of an edit, which is why backup
 * and sync systems cut on content instead: a rolling hash over the last few dozen
 * bytes decides where a chunk ends, so inserting a byte at the front moves exactly
 * one boundary and every other chunk keeps its identity. The store then keeps one
 * copy of each distinct chunk and each file is just a list of hashes.
 */

import { SearchStopped, yieldToBrowser } from './run';

// Gear table: each byte value maps to a fixed pseudo-random word, so the rolling hash
// depends on the recent bytes rather than their positions.
const GEAR = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  GEAR[i] = Math.floor(Math.abs(Math.sin(i + 1) * 43758.5453) * 4294967296) >>> 0;
}

const roundPow2 = (value) => Math.max(6, Math.round(Math.log2(Math.max(64, value))));

export function contentChunks(bytes, { avgSize = 8192, minSize, maxSize } = {}) {
  const bits = roundPow2(avgSize);
  const mask = (1 << bits) - 1;
  const minimum = Math.max(64, minSize ?? Math.round(avgSize / 4));
  const maximum = Math.max(minimum * 2, maxSize ?? Math.round(avgSize * 4));
  const ranges = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + maximum, bytes.length);
    let hash = 0;
    let i = start + minimum;
    while (i < end) {
      hash = ((hash << 1) + GEAR[bytes[i]]) >>> 0;
      if ((hash & mask) === 0) {
        end = i + 1;
        break;
      }
      i += 1;
    }
    ranges.push([start, end]);
    start = end;
  }
  return ranges;
}

export function fixedChunks(bytes, size = 8192) {
  const ranges = [];
  for (let start = 0; start < bytes.length; start += size) {
    ranges.push([start, Math.min(start + size, bytes.length)]);
  }
  return ranges;
}

export function chunkBytes(bytes, { mode = 'content', avgSize = 8192, fixedSize = 8192 } = {}) {
  return mode === 'fixed' ? fixedChunks(bytes, fixedSize) : contentChunks(bytes, { avgSize });
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Chunk every file, hash every chunk, and keep one copy of each distinct chunk. The
 * per-file accounting is what makes deduplication visible: bytes first seen in a file
 * are its own, bytes already in the store cost nothing.
 */
export async function dedupeFiles(files, options = {}, { onProgress, signal } = {}) {
  const store = new Map();
  const entries = [];
  const totalBytes = files.reduce((sum, file) => sum + file.bytes.length, 0);
  let done = 0;

  for (const file of files) {
    const ranges = chunkBytes(file.bytes, options);
    const chunks = [];
    let storedBytes = 0;
    for (const [start, end] of ranges) {
      const slice = file.bytes.subarray(start, end);
      const hash = await sha256Hex(slice);
      const existing = store.get(hash);
      if (existing) {
        existing.refs += 1;
        existing.files.add(file.name);
      } else {
        store.set(hash, { bytes: slice.slice(), size: end - start, refs: 1, files: new Set([file.name]), firstFile: file.name });
        storedBytes += end - start;
      }
      chunks.push(hash);
    }
    done += file.bytes.length;
    entries.push({ name: file.name, size: file.bytes.length, chunks, ranges, storedBytes });
    await yieldToBrowser();
    onProgress?.({ phase: 'Chunking and hashing', done, total: totalBytes, file: file.name });
    if (signal?.aborted) throw new SearchStopped('cancelled');
  }

  const storedBytes = [...store.values()].reduce((sum, chunk) => sum + chunk.size, 0);
  const sizes = [...store.values()].map((chunk) => chunk.size);
  const sharedChunks = [...store.values()].filter((chunk) => chunk.refs > 1).length;
  const totalChunks = entries.reduce((sum, entry) => sum + entry.chunks.length, 0);

  return {
    entries,
    store,
    stats: {
      originalBytes: totalBytes,
      storedBytes,
      ratio: storedBytes ? totalBytes / storedBytes : 0,
      savedBytes: totalBytes - storedBytes,
      totalChunks,
      uniqueChunks: store.size,
      sharedChunks,
      averageChunk: sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : 0,
      largestChunk: sizes.length ? Math.max(...sizes) : 0,
      smallestChunk: sizes.length ? Math.min(...sizes) : 0,
    },
  };
}

/** Rebuild a file from the store alone, so the result can be compared byte for byte. */
export async function rebuild(entry, store) {
  const total = entry.ranges.reduce((sum, [start, end]) => sum + (end - start), 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  entry.chunks.forEach((hash) => {
    const chunk = store.get(hash);
    bytes.set(chunk.bytes, offset);
    offset += chunk.bytes.length;
  });
  return { bytes, digest: await sha256Hex(bytes) };
}

/** Chunk boundaries as 0–1 positions, for drawing the strip in the interface. */
export function boundaryPositions(entry) {
  return entry.ranges.map(([start, end]) => ({ from: start / entry.size, to: end / entry.size }));
}