import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import type { EntryKind, FileEntry } from '../../shared/model';
import { childPath, requireAbsolute, validateName } from './paths';
import type { JobGate } from '../jobs/PauseGate';

/**
 * Filesystem service. The only module (with OperationManager) that touches the
 * disk on behalf of the UI. Pure Node — no Electron imports — so it is unit
 * testable against temporary directories.
 */

export function kindFromStats(st: fs.Stats): EntryKind {
  if (st.isSymbolicLink()) return 'symlink';
  if (st.isDirectory()) return 'directory';
  if (st.isFile()) return 'file';
  return 'other';
}

export function extOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
}

function isHiddenName(name: string): boolean {
  return name.startsWith('.');
}

/** Build a FileEntry from lstat, resolving symlink targets without following loops. */
export async function entryFor(p: string): Promise<FileEntry> {
  const name = path.basename(p) || p;
  const st = await fsp.lstat(p, { bigint: false });
  const kind = kindFromStats(st);
  const entry: FileEntry = {
    path: p,
    name,
    kind,
    ext: kind === 'directory' ? '' : extOf(name),
    hidden: isHiddenName(name),
    size: kind === 'file' ? st.size : undefined,
    modifiedMs: st.mtimeMs,
    createdMs: st.birthtimeMs > 0 ? st.birthtimeMs : undefined,
    accessedMs: st.atimeMs,
    dev: st.dev,
    ino: st.ino,
    mode: st.mode,
    uid: process.platform === 'win32' ? undefined : st.uid,
    gid: process.platform === 'win32' ? undefined : st.gid,
    allocatedBytes: typeof st.blocks === 'number' && process.platform !== 'win32' ? st.blocks * 512 : undefined,
    readOnly: process.platform === 'win32' ? (st.mode & 0o200) === 0 : undefined,
  };
  if (kind === 'symlink') {
    try {
      entry.linkTarget = await fsp.readlink(p);
      const target = await fsp.stat(p);
      entry.linkTargetKind = kindFromStats(target);
      if (entry.linkTargetKind === 'file') entry.size = target.size;
    } catch {
      entry.linkTargetKind = 'broken';
    }
  }
  return entry;
}

/** Run async work over items with a fixed concurrency bound. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface ListOptions {
  showHidden: boolean;
  batchSize?: number;
  statConcurrency?: number;
  signal?: AbortSignal;
}

/**
 * List a directory incrementally. Yields batches of entries as they are
 * stat'ed so the UI can render large directories progressively. Entries whose
 * lstat fails are still yielded with `statError` set.
 */
export async function* listDirectory(dirPath: string, opts: ListOptions): AsyncGenerator<FileEntry[]> {
  const dir = requireAbsolute(dirPath, 'fs.list');
  const batchSize = opts.batchSize ?? 400;
  const concurrency = opts.statConcurrency ?? 32;
  let handle: fs.Dir;
  try {
    handle = await fsp.opendir(dir, { bufferSize: 256 });
  } catch (err) {
    throw new OrbisError(toOrbisError(err, 'fs.list', dir, 'no'));
  }
  let pending: string[] = [];
  try {
    for await (const dirent of handle) {
      if (opts.signal?.aborted) throw makeError('cancelled', 'fs.list', { target: dir });
      if (!opts.showHidden && isHiddenName(dirent.name)) continue;
      pending.push(dirent.name);
      if (pending.length >= batchSize) {
        yield await statBatch(dir, pending, concurrency);
        pending = [];
      }
    }
    if (pending.length) yield await statBatch(dir, pending, concurrency);
  } finally {
    // for-await closes the handle on completion; close defensively on early exit.
    await handle.close().catch(() => undefined);
  }
}

async function statBatch(dir: string, names: string[], concurrency: number): Promise<FileEntry[]> {
  return mapLimit(names, concurrency, async (name) => {
    const p = path.join(dir, name);
    try {
      return await entryFor(p);
    } catch (err) {
      const e = toOrbisError(err, 'fs.stat', p);
      return { path: p, name, kind: 'other' as const, ext: extOf(name), hidden: isHiddenName(name), statError: e.category };
    }
  });
}

export async function statPath(p: string): Promise<FileEntry> {
  const abs = requireAbsolute(p, 'fs.stat');
  try {
    return await entryFor(abs);
  } catch (err) {
    throw new OrbisError(toOrbisError(err, 'fs.stat', abs, 'no'));
  }
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fsp.lstat(p);
    return true;
  } catch {
    return false;
  }
}

export async function makeDirectory(parent: string, name: string): Promise<FileEntry> {
  const dir = requireAbsolute(parent, 'fs.mkdir');
  const target = childPath(dir, name, 'fs.mkdir');
  try {
    await fsp.mkdir(target); // non-recursive: fails with EEXIST instead of silently succeeding
  } catch (err) {
    throw new OrbisError(toOrbisError(err, 'fs.mkdir', target, 'no'));
  }
  return entryFor(target);
}

const TEMPLATES: Record<string, string> = {
  empty: '',
  text: '',
  markdown: '# Untitled\n',
  json: '{}\n',
};

/** Create a new file. Uses the exclusive "wx" flag so an existing file is never overwritten. */
export async function createFile(parent: string, name: string, template: keyof typeof TEMPLATES): Promise<FileEntry> {
  const dir = requireAbsolute(parent, 'fs.createFile');
  const target = childPath(dir, name, 'fs.createFile');
  try {
    await fsp.writeFile(target, TEMPLATES[template] ?? '', { flag: 'wx', encoding: 'utf8' });
  } catch (err) {
    throw new OrbisError(toOrbisError(err, 'fs.createFile', target, 'no'));
  }
  return entryFor(target);
}

/**
 * Rename within the same folder. Refuses to overwrite. Case-only renames on
 * case-insensitive file systems go through a temporary name.
 */
export async function renamePath(p: string, newName: string): Promise<FileEntry> {
  const src = requireAbsolute(p, 'fs.rename');
  const parent = path.dirname(src);
  const dest = childPath(parent, newName, 'fs.rename');
  if (dest === src) return entryFor(src);
  try {
    await fsp.lstat(src);
  } catch (err) {
    throw new OrbisError(toOrbisError(err, 'fs.rename', src, 'no'));
  }
  const caseOnly = dest.toLowerCase() === src.toLowerCase();
  if (caseOnly) {
    // Detect whether the FS treats these as the same entry.
    const sameEntry = await sameFile(src, dest);
    if (sameEntry) {
      const tmp = path.join(parent, `.orbis-rename-${crypto.randomUUID()}`);
      try {
        await fsp.rename(src, tmp);
        await fsp.rename(tmp, dest);
      } catch (err) {
        if (await exists(tmp)) await fsp.rename(tmp, src).catch(() => undefined);
        throw new OrbisError(toOrbisError(err, 'fs.rename', src, 'unknown'));
      }
      return entryFor(dest);
    }
  }
  if (await exists(dest)) {
    throw makeError('already_exists', 'fs.rename', { target: dest, message: `"${newName}" already exists in this folder.` });
  }
  try {
    // A race remains between the check and rename on POSIX; rename() would
    // replace a file created in that window. link()+unlink() avoids that for
    // files on the same volume, so prefer it where it works.
    const st = await fsp.lstat(src);
    if (st.isFile() && process.platform !== 'win32') {
      let linked = false;
      try {
        await fsp.link(src, dest);
        linked = true;
      } catch (linkErr) {
        const code = (linkErr as { code?: string }).code;
        if (code === 'EEXIST') throw makeError('already_exists', 'fs.rename', { target: dest });
        // Other codes (EPERM, ENOTSUP, EMLINK…): file system lacks hard links; fall back to rename below.
      }
      if (linked) {
        try {
          await fsp.unlink(src);
        } catch (unlinkErr) {
          await fsp.unlink(dest).catch(() => undefined);
          throw new OrbisError(toOrbisError(unlinkErr, 'fs.rename', src, 'no'));
        }
        return entryFor(dest);
      }
    }
    await fsp.rename(src, dest);
  } catch (err) {
    throw new OrbisError(toOrbisError(err, 'fs.rename', src, 'no'));
  }
  return entryFor(dest);
}

async function sameFile(a: string, b: string): Promise<boolean> {
  try {
    const [sa, sb] = await Promise.all([fsp.lstat(a), fsp.lstat(b)]);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}

export function checkName(parent: string, name: string): Promise<{ valid: boolean; reason?: string; exists?: boolean }> {
  const v = validateName(name);
  if (!v.valid) return Promise.resolve(v);
  const target = path.join(parent, name);
  return exists(target).then((e) => (e ? { valid: false, reason: 'An item with this name already exists.', exists: true } : { valid: true }));
}

export interface TextRead {
  text: string;
  encoding: 'utf8' | 'utf16le' | 'utf16be' | 'latin1';
  truncated: boolean;
  totalBytes: number;
  binary: boolean;
  /** Byte offset this chunk starts at, and where the next chunk starts (undefined at the end). */
  offset: number;
  nextOffset?: number;
}

export function detectEncoding(head: Buffer): { encoding: TextRead['encoding']; bom: number } {
  if (head[0] === 0xff && head[1] === 0xfe) return { encoding: 'utf16le', bom: 2 };
  if (head[0] === 0xfe && head[1] === 0xff) return { encoding: 'utf16be', bom: 2 };
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return { encoding: 'utf8', bom: 3 };
  // UTF-16 without a BOM: mostly-ASCII text has a zero in every other byte.
  const n = Math.min(head.length - (head.length % 2), 512);
  if (n >= 8) {
    let evenZero = 0;
    let oddZero = 0;
    for (let i = 0; i < n; i += 2) {
      if (head[i] === 0) evenZero++;
      if (head[i + 1] === 0) oddZero++;
    }
    if (oddZero > n / 2 * 0.7 && evenZero < n / 2 * 0.1) return { encoding: 'utf16le', bom: 0 };
    if (evenZero > n / 2 * 0.7 && oddZero < n / 2 * 0.1) return { encoding: 'utf16be', bom: 0 };
  }
  return { encoding: 'utf8', bom: 0 };
}

/**
 * Read a chunk of a text file (from `offset`, up to `maxBytes`). Detects BOMs,
 * UTF-16 without BOM, binary content, and falls back to Latin-1 for invalid
 * UTF-8. Chunk boundaries never split a character, so a large file can be
 * read page by page.
 */
export async function readText(p: string, maxBytes: number, offset = 0): Promise<TextRead> {
  const abs = requireAbsolute(p, 'fs.readText');
  let fh: fsp.FileHandle | undefined;
  try {
    fh = await fsp.open(abs, 'r');
    const st = await fh.stat();
    if (!st.isFile()) throw makeError('is_a_directory', 'fs.readText', { target: abs });
    const headBuf = Buffer.alloc(Math.min(st.size, 4096));
    await fh.read(headBuf, 0, headBuf.length, 0);
    const { encoding: detected, bom } = detectEncoding(headBuf);
    let encoding: TextRead['encoding'] = detected;
    let start = Math.max(offset, bom);
    if (encoding !== 'utf8' && (start - bom) % 2) start += 1;
    const len = Math.max(0, Math.min(st.size - start, maxBytes));
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, start);
    let data = buf.subarray(0, bytesRead);
    if (encoding === 'utf8') {
      // Skip continuation bytes at a chunk start; drop an incomplete character at the end.
      let s0 = 0;
      if (start > bom) while (s0 < data.length && s0 < 4 && (data[s0]! & 0xc0) === 0x80) s0++;
      let e0 = data.length;
      if (start + bytesRead < st.size) {
        let i = data.length - 1;
        let back = 0;
        while (i >= 0 && back < 4 && (data[i]! & 0xc0) === 0x80) {
          i--;
          back++;
        }
        if (i >= 0) {
          const lead = data[i]!;
          const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
          if (need > back + 1) e0 = i;
        }
      }
      start += s0;
      data = data.subarray(s0, e0);
    } else if (data.length % 2) data = data.subarray(0, data.length - 1);
    const binary = encoding === 'utf8' && looksBinary(data);
    let text = '';
    if (!binary) {
      if (encoding === 'utf16le') text = data.toString('utf16le');
      else if (encoding === 'utf16be') {
        const c = Buffer.from(data);
        c.swap16();
        text = c.toString('utf16le');
      } else {
        text = new TextDecoder('utf-8', { fatal: false }).decode(data);
        if (text.includes('\uFFFD') && !isValidUtf8(data)) {
          encoding = 'latin1';
          text = data.toString('latin1');
        }
      }
    }
    const end = start + data.length;
    return { text, encoding, truncated: end < st.size || start > bom, totalBytes: st.size, binary, offset: start, nextOffset: end < st.size ? end : undefined };
  } catch (err) {
    throw new OrbisError(toOrbisError(err, 'fs.readText', abs, 'no'));
  } finally {
    await fh?.close();
  }
}

export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  if (n === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i]!;
    if (b === 0) return true;
    if (b < 7 || (b > 14 && b < 32 && b !== 27)) suspicious++;
  }
  return suspicious / n > 0.1;
}

function isValidUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, Math.max(0, buf.length - 4)));
    return true;
  } catch {
    return false;
  }
}

export async function readHead(p: string, bytes: number): Promise<Buffer> {
  const abs = requireAbsolute(p, 'fs.readHead');
  const fh = await fsp.open(abs, 'r').catch((err) => {
    throw new OrbisError(toOrbisError(err, 'fs.readHead', abs, 'no'));
  });
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** Streaming hash with progress and cancellation. Never returns a partial digest. */
export async function hashFile(
  p: string,
  algorithm: 'sha256' | 'sha1' | 'md5' | 'sha512' | 'sha224' | 'sha384',
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
  gate?: JobGate,
): Promise<{ algorithm: string; digest: string; bytes: number }> {
  const abs = requireAbsolute(p, 'fs.hash');
  const st = await fsp.stat(abs).catch((err) => {
    throw new OrbisError(toOrbisError(err, 'fs.hash', abs, 'no'));
  });
  if (!st.isFile()) throw makeError('is_a_directory', 'fs.hash', { target: abs });
  const hash = crypto.createHash(algorithm);
  let done = 0;
  let lastReport = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(abs, { highWaterMark: 1024 * 1024, signal });
    stream.on('data', (chunk) => {
      // Paused: stop reading after this chunk until resumed (or cancelled, which destroys the stream).
      if (gate?.isPaused) {
        stream.pause();
        void gate.wait().then(() => {
          if (!stream.destroyed) stream.resume();
        });
      }
      hash.update(chunk as Buffer);
      done += (chunk as Buffer).length;
      const now = Date.now();
      if (now - lastReport > 100) {
        lastReport = now;
        onProgress(done, st.size);
      }
    });
    stream.on('error', (err) => reject(signal.aborted ? makeError('cancelled', 'fs.hash', { target: abs }) : new OrbisError(toOrbisError(err, 'fs.hash', abs, 'no'))));
    stream.on('end', () => resolve());
  });
  onProgress(done, st.size);
  return { algorithm, digest: hash.digest('hex'), bytes: done };
}

export interface TreeSize {
  bytes: number;
  files: number;
  directories: number;
  symlinksSkipped: number;
  errors: number;
  complete: boolean;
  /** True when counting stopped at the entry limit (the total is then a lower bound). */
  limited?: boolean;
}

/**
 * Recursively total a folder without following symlinks. Tracks dev:ino to
 * avoid counting hard-linked directories (bind mounts) twice. With
 * `maxEntries`, counting stops after that many entries and the result is
 * marked `limited` (a lower bound, not complete).
 */
export async function folderSize(root: string, signal: AbortSignal, onProgress?: (t: TreeSize) => void, gate?: JobGate, opts: { maxEntries?: number } = {}): Promise<TreeSize> {
  const abs = requireAbsolute(root, 'fs.folderSize');
  const result: TreeSize = { bytes: 0, files: 0, directories: 0, symlinksSkipped: 0, errors: 0, complete: false };
  const seen = new Set<string>();
  const stack = [abs];
  let lastReport = 0;
  let entries = 0;
  const max = opts.maxEntries ?? Infinity;
  while (stack.length) {
    if (signal.aborted) return result;
    if (entries >= max) {
      result.limited = true;
      return result;
    }
    const dir = stack.pop()!;
    let dh: fs.Dir;
    try {
      dh = await fsp.opendir(dir);
    } catch {
      result.errors++;
      continue;
    }
    try {
      for await (const d of dh) {
        if (gate?.isPaused) await gate.wait();
        if (signal.aborted) break;
        if (++entries > max) {
          result.limited = true;
          break;
        }
        const p = path.join(dir, d.name);
        try {
          const st = await fsp.lstat(p);
          if (st.isSymbolicLink()) {
            result.symlinksSkipped++;
          } else if (st.isDirectory()) {
            const key = `${st.dev}:${st.ino}`;
            if (!seen.has(key)) {
              seen.add(key);
              result.directories++;
              stack.push(p);
            }
          } else {
            result.files++;
            result.bytes += st.size;
          }
        } catch {
          result.errors++;
        }
      }
    } catch {
      result.errors++;
    }
    const now = Date.now();
    if (onProgress && now - lastReport > 200) {
      lastReport = now;
      onProgress({ ...result });
    }
  }
  result.complete = !signal.aborted && !result.limited;
  return result;
}

/** Most entries counted per child folder by "Calculate folder sizes" before its total is shown as "at least". */
export const CHILD_FOLDER_ENTRY_LIMIT = 1_000_000;

export interface ChildFolderSizes {
  dir: string;
  /** Totals by child folder path (folders not reached because of cancellation are absent). */
  sizes: Record<string, TreeSize>;
  folders: number;
  complete: boolean;
}

/**
 * Sizes of the child folders of `dir` (not following links: links to folders
 * are not counted), one after another, for the Size column. Pausable between
 * entries, cancellable; progress carries every total calculated so far.
 */
export async function childFolderSizes(
  dir: string,
  signal: AbortSignal,
  onProgress?: (p: { checked: number; total: number; current?: string; sizes: Record<string, TreeSize> }) => void,
  gate?: JobGate,
  /** skipHidden: leave out hidden folders (the folder view does not show them, so they would only be counted unseen). */
  opts: { maxEntriesPerFolder?: number; skipHidden?: boolean } = {},
): Promise<ChildFolderSizes> {
  const abs = requireAbsolute(dir, 'fs.childFolderSizes');
  let dirents: fs.Dirent[];
  try {
    dirents = await fsp.readdir(abs, { withFileTypes: true });
  } catch (err) {
    throw new OrbisError(toOrbisError(err, 'fs.childFolderSizes', abs, 'no'));
  }
  const children = dirents.filter((d) => d.isDirectory() && !(opts.skipHidden && isHiddenName(d.name))).map((d) => path.join(abs, d.name)).sort();
  const sizes: Record<string, TreeSize> = {};
  let checked = 0;
  for (const child of children) {
    if (gate?.isPaused) await gate.wait();
    if (signal.aborted) break;
    onProgress?.({ checked, total: children.length, current: child, sizes });
    sizes[child] = await folderSize(child, signal, undefined, gate, { maxEntries: opts.maxEntriesPerFolder ?? CHILD_FOLDER_ENTRY_LIMIT });
    checked++;
    onProgress?.({ checked, total: children.length, sizes });
  }
  return { dir: abs, sizes, folders: children.length, complete: !signal.aborted && checked === children.length };
}

/** Largest file "Copy file contents as text" copies. */
export const COPY_TEXT_MAX_BYTES = 1024 * 1024;

/**
 * Read a small text file as UTF-8 for the clipboard. Refuses files over
 * `maxBytes`, binary content and bytes that are not valid UTF-8 (rather than
 * copying replacement characters). A UTF-8 byte order mark is dropped.
 */
export async function readUtf8Text(p: string, maxBytes = COPY_TEXT_MAX_BYTES): Promise<{ text: string; bytes: number }> {
  const abs = requireAbsolute(p, 'fs.copyContents');
  const st = await fsp.stat(abs).catch((err) => {
    throw new OrbisError(toOrbisError(err, 'fs.copyContents', abs, 'no'));
  });
  if (!st.isFile()) throw makeError('is_a_directory', 'fs.copyContents', { target: abs, message: 'Only the contents of a file can be copied.' });
  if (st.size > maxBytes) throw makeError('validation', 'fs.copyContents', { target: abs, message: `This file is ${(st.size / 1024 / 1024).toFixed(1)} MB; contents are copied as text only up to ${Math.round(maxBytes / 1024)} KB.` });
  const buf = await fsp.readFile(abs).catch((err) => {
    throw new OrbisError(toOrbisError(err, 'fs.copyContents', abs, 'no'));
  });
  if (buf.length > maxBytes) throw makeError('validation', 'fs.copyContents', { target: abs, message: 'The file grew past the size limit while it was read.' });
  if (looksBinary(buf)) throw makeError('unsupported', 'fs.copyContents', { target: abs, message: 'This file contains binary data, not text.' });
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    throw makeError('unsupported', 'fs.copyContents', { target: abs, message: 'This file is not UTF-8 text, so it is not copied (other encodings could come out garbled).' });
  }
  return { text: text.replace(/^\uFEFF/, ''), bytes: buf.length };
}
