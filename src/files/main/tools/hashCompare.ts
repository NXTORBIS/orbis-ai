import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fsp from 'node:fs/promises';
import type { HashAlgorithm, HashCompareResult } from '../../shared/hashCompare';

/**
 * File hash comparator: compute hashes of two files and compare them.
 * Supports MD5, SHA-1, SHA-256 and SHA-512.
 */

/** Compute the hash of a single file. Reports progress through a callback. */
async function hashFile(
  filePath: string,
  algorithm: HashAlgorithm,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<{ hash: string; size: number }> {
  const stat = await fsp.stat(filePath);
  const size = stat.size;
  const hash = createHash(algorithm);
  let done = 0;

  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    const onAbort = () => { stream.destroy(); reject(new Error('Aborted')); };
    signal.addEventListener('abort', onAbort, { once: true });

    stream.on('data', (chunk: string | Buffer) => {
      if (typeof chunk === 'string') chunk = Buffer.from(chunk);
      hash.update(chunk);
      done += chunk.length;
      onProgress?.(done, size);
    });
    stream.on('end', () => {
      signal.removeEventListener('abort', onAbort);
      resolve({ hash: hash.digest('hex'), size });
    });
    stream.on('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });
  });
}

/** Compare two files by hash. */
export async function compareFileHashes(
  pathA: string,
  pathB: string,
  algorithm: HashAlgorithm,
  signal: AbortSignal,
  onProgress?: (phase: 'A' | 'B', done: number, total: number) => void,
): Promise<HashCompareResult> {
  const [a, b] = await Promise.all([
    hashFile(pathA, algorithm, signal, (done, total) => onProgress?.('A', done, total)),
    hashFile(pathB, algorithm, signal, (done, total) => onProgress?.('B', done, total)),
  ]);

  return {
    pathA,
    pathB,
    algorithm,
    hashA: a.hash,
    hashB: b.hash,
    sizeA: a.size,
    sizeB: b.size,
    match: a.hash === b.hash,
  };
}
