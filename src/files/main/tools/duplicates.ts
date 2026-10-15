import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeError } from '../../shared/errors';
import { compileGlobs, matchesAny } from '../../shared/glob';
import type { DuplicateGroup, DupFile } from '../../shared/dedupe';
import type { JobGate } from '../jobs/PauseGate';

/**
 * Duplicate detection.
 *
 * Content mode (default) is staged so most files are never read in full:
 *   1. size — only files sharing a size with another file go on;
 *   2. partial hash — SHA-256 of the first and last 64 KB (files over 128 KB);
 *   3. full SHA-256 — only files whose partial hashes match are read in full.
 * Only files with identical full SHA-256 are grouped.
 *
 * "Same name and size" mode groups files by name (case-insensitive) and size
 * without reading them. It is fast but NOT a content check; its groups are
 * labelled `name-size` and every action re-verifies contents before acting.
 */

export interface DuplicateOptions {
  roots: string[];
  /** Files smaller than this (bytes) are ignored. Empty files are never grouped. */
  minSize: number;
  maxSize?: number;
  /** Only files matching one of these globs are considered (all when empty). */
  include?: string[];
  /** Files and folders matching these globs are skipped. */
  exclude?: string[];
  /** Skip files and folders whose names start with "." */
  skipHidden?: boolean;
  mode?: 'content' | 'name-size';
  /** Stop listing after this many candidate files (protects memory on huge trees). */
  maxFiles?: number;
}

export interface DuplicateReport {
  mode: 'content' | 'name-size';
  groups: DuplicateGroup[];
  scannedFiles: number;
  candidates: number;
  hashedBytes: number;
  complete: boolean;
  cancelled: boolean;
  limitReached: boolean;
  unreadable: number;
  reclaimableBytes: number;
  notes: string[];
}

export type DuplicateProgress = { stage: 'scanning' | 'comparing' | 'verifying'; done: number; total?: number; current?: string };

const PARTIAL = 64 * 1024;
const CHUNK = 1024 * 1024;
export const DEFAULT_MAX_FILES = 2_000_000;

/** SHA-256 of a whole file, read in 1 MB chunks; waits at the gate between chunks so large files pause too. */
export async function sha256File(p: string, signal?: AbortSignal, gate?: JobGate, onBytes?: (n: number) => void): Promise<string> {
  const h = crypto.createHash('sha256');
  const fh = await fsp.open(p, 'r');
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    for (;;) {
      if (gate?.isPaused) await gate.wait();
      if (signal?.aborted) throw makeError('cancelled', 'tool.hash');
      const { bytesRead } = await fh.read(buf, 0, CHUNK, null);
      if (!bytesRead) break;
      h.update(buf.subarray(0, bytesRead));
      onBytes?.(bytesRead);
    }
  } finally {
    await fh.close();
  }
  return h.digest('hex');
}

async function partialHash(p: string, size: number): Promise<string> {
  const fh = await fsp.open(p, 'r');
  try {
    const a = Buffer.alloc(PARTIAL);
    const b = Buffer.alloc(PARTIAL);
    const ra = await fh.read(a, 0, PARTIAL, 0);
    const rb = await fh.read(b, 0, PARTIAL, Math.max(0, size - PARTIAL));
    return crypto.createHash('sha256').update(a.subarray(0, ra.bytesRead)).update(b.subarray(0, rb.bytesRead)).digest('hex');
  } finally {
    await fh.close();
  }
}

type Cand = DupFile & { name: string };

export async function findDuplicates(opts: DuplicateOptions, signal: AbortSignal, onProgress: (p: DuplicateProgress) => void, gate?: JobGate): Promise<DuplicateReport> {
  const mode = opts.mode ?? 'content';
  const minSize = Math.max(1, opts.minSize);
  const maxSize = opts.maxSize && opts.maxSize > 0 ? opts.maxSize : Infinity;
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const inc = compileGlobs(opts.include ?? []);
  const exc = compileGlobs(opts.exclude ?? []);
  const filterErrors = [...inc.errors, ...exc.errors];
  if (filterErrors.length) throw makeError('validation', 'tool.duplicates', { message: `Some filter patterns are not valid: ${filterErrors.join('; ')}` });
  for (const r of opts.roots) {
    const st = await fsp.stat(r).catch(() => undefined);
    if (!st?.isDirectory()) throw makeError('not_a_directory', 'tool.duplicates', { target: r });
  }

  const byKey = new Map<string, Cand[]>();
  const seenFiles = new Set<string>();
  const seenDirs = new Set<string>();
  let scanned = 0;
  let unreadable = 0;
  let limitReached = false;
  let lastEmit = 0;

  outer: for (const root of opts.roots) {
    const rootSt = await fsp.stat(root);
    const rootKey = `${rootSt.dev}:${rootSt.ino}`;
    if (seenDirs.has(rootKey)) continue; // the same folder given twice
    seenDirs.add(rootKey);
    const stack = [root];
    while (stack.length) {
      if (signal.aborted) break outer;
      const dir = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        unreadable++;
        continue;
      }
      for (const d of entries) {
        if (gate?.isPaused) await gate.wait();
        if (signal.aborted) break outer;
        if (d.isSymbolicLink()) continue; // links are never followed or grouped
        if (opts.skipHidden && d.name.startsWith('.')) continue;
        const p = path.join(dir, d.name);
        const rel = path.relative(root, p).split(path.sep).join('/');
        if (exc.globs.length && matchesAny(exc.globs, rel, d.name)) continue;
        try {
          const s = await fsp.lstat(p);
          const key = `${s.dev}:${s.ino}`;
          if (s.isDirectory()) {
            if (!seenDirs.has(key)) {
              seenDirs.add(key);
              stack.push(p);
            }
            continue;
          }
          if (!s.isFile() || s.size < minSize || s.size > maxSize) continue;
          if (inc.globs.length && !matchesAny(inc.globs, rel, d.name)) continue;
          // Hard links to the same inode are one file, not duplicates.
          if (seenFiles.has(key)) continue;
          seenFiles.add(key);
          scanned++;
          const groupKey = mode === 'content' ? String(s.size) : `${s.size}\0${d.name.toLowerCase()}`;
          const list = byKey.get(groupKey);
          const cand: Cand = { path: p, modifiedMs: s.mtimeMs, createdMs: s.birthtimeMs || undefined, name: d.name };
          if (list) list.push(cand);
          else byKey.set(groupKey, [cand]);
          if (scanned >= maxFiles) {
            limitReached = true;
            break outer;
          }
          const t = Date.now();
          if (t - lastEmit > 200) {
            lastEmit = t;
            onProgress({ stage: 'scanning', done: scanned, current: dir });
          }
        } catch {
          unreadable++;
        }
      }
    }
  }

  const keyed = [...byKey.entries()].filter(([, l]) => l.length > 1);
  const candidates = keyed.reduce((a, [, l]) => a + l.length, 0);
  const groups: DuplicateGroup[] = [];
  let hashedBytes = 0;
  const strip = (c: Cand): DupFile => ({ path: c.path, modifiedMs: c.modifiedMs, createdMs: c.createdMs });

  if (mode === 'name-size') {
    for (const [key, list] of keyed) {
      const size = Number(key.slice(0, key.indexOf('\0')));
      groups.push({ id: `ns:${size}:${list[0]!.name.toLowerCase()}`, size, files: list.map(strip), verification: 'name-size', reclaimableBytes: size * (list.length - 1) });
    }
  } else {
    let done = 0;
    for (const [sizeKey, list] of keyed) {
      if (signal.aborted) break;
      const size = Number(sizeKey);
      // Stage 2: partial hash, only worth it when it reads less than the whole file.
      let buckets: Cand[][] = [list];
      if (size > 2 * PARTIAL) {
        const byPartial = new Map<string, Cand[]>();
        for (const f of list) {
          if (gate?.isPaused) await gate.wait();
          if (signal.aborted) break;
          try {
            const h = await partialHash(f.path, size);
            byPartial.set(h, [...(byPartial.get(h) ?? []), f]);
          } catch {
            unreadable++;
          }
          onProgress({ stage: 'comparing', done, total: candidates, current: f.path });
        }
        buckets = [...byPartial.values()];
      }
      // Stage 3: full SHA-256 for files that still match.
      for (const bucket of buckets) {
        if (bucket.length < 2) {
          done += bucket.length;
          continue;
        }
        const byFull = new Map<string, Cand[]>();
        for (const f of bucket) {
          if (signal.aborted) break;
          try {
            const h = await sha256File(f.path, signal, gate);
            hashedBytes += size;
            byFull.set(h, [...(byFull.get(h) ?? []), f]);
          } catch {
            if (!signal.aborted) unreadable++;
          }
          done++;
          onProgress({ stage: 'verifying', done, total: candidates, current: f.path });
        }
        for (const [hash, files] of byFull) {
          if (files.length > 1) groups.push({ id: hash, hash, size, files: files.map(strip), verification: 'sha256', reclaimableBytes: size * (files.length - 1) });
        }
      }
    }
  }
  groups.sort((a, b) => b.reclaimableBytes - a.reclaimableBytes || b.files.length - a.files.length);

  const notes: string[] = [];
  if (mode === 'name-size') notes.push('Grouped by name and size only. Contents were NOT compared; every action checks contents again before it changes anything.');
  else notes.push('Grouped only when the full contents match (SHA-256). Large files were first compared by their first and last 64 KB.');
  notes.push('Hard links to the same file are counted once; symbolic links are not followed.');
  if (minSize > 1) notes.push(`Files smaller than ${minSize.toLocaleString()} bytes were not considered.`);
  if (opts.include?.length) notes.push(`Only files matching ${opts.include.join(', ')}.`);
  if (opts.exclude?.length) notes.push(`Skipped ${opts.exclude.join(', ')}.`);
  if (opts.skipHidden) notes.push('Hidden files and folders were skipped.');
  if (limitReached) notes.push(`Stopped after ${maxFiles.toLocaleString()} files; choose a smaller folder or a filter to search the rest.`);
  return {
    mode, groups, scannedFiles: scanned, candidates, hashedBytes, unreadable, notes, limitReached,
    complete: !signal.aborted && unreadable === 0 && !limitReached, cancelled: signal.aborted,
    reclaimableBytes: groups.reduce((a, g) => a + g.reclaimableBytes, 0),
  };
}
