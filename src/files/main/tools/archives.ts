import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import yauzl from 'yauzl';
import yazl from 'yazl';
import * as tar from 'tar';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import { readHead, exists } from '../fs/FileSystemService';
import { isWithin, uniqueName, validateName } from '../fs/paths';
import type { ExternalRunner, RunnerHelpers, RunContext } from '../ops/OperationManager';
import type { OperationRecord } from '../../shared/operations';
import os from 'node:os';
import { extract7z, list7z, test7z, create7z, passwordError, sevenZipAvailable, sevenZipHeaderEncrypted } from './sevenZip';
import { scrubSecret } from './sevenZipCore';
import { ARCHIVE_PASSWORD_MAX } from '../../shared/ipc';

/**
 * Archive support.
 *  - Formats are identified by content (magic bytes), never by extension alone.
 *  - ZIP (read/write), TAR and TAR.GZ (read/write) and GZIP use Node libraries.
 *  - 7z (read/write), RAR/RAR5, XZ, BZIP2 and ZSTD (read, including .tar.xz,
 *    .tar.bz2 and .tar.zst) use 7-Zip compiled to WebAssembly (sevenZip.ts),
 *    extracting into a private temporary folder that is checked before any
 *    file is moved to the destination.
 *  - Extraction refuses absolute paths, ".." traversal, drive letters and
 *    link entries; enforces entry-count, total-size and ratio limits; and writes
 *    each file to a temporary sibling before an exclusive commit.
 *  - Encrypted archives (ZipCrypto/AES ZIP, 7z, RAR) are read through 7-Zip
 *    with a password the user typed. The password is only ever held in memory
 *    for the request: it is never logged, persisted, or put in error messages
 *    or operation records.
 */

export type ArchiveFormat = 'zip' | 'tar' | 'tar.gz' | 'gzip' | '7z' | 'rar' | 'xz' | 'bzip2' | 'zstd' | 'unknown';

export interface ArchiveLimits {
  maxEntries: number;
  maxTotalBytes: number;
  /** Maximum uncompressed/compressed ratio for the archive as a whole. */
  maxRatio: number;
}

export const DEFAULT_LIMITS: ArchiveLimits = { maxEntries: 500_000, maxTotalBytes: 64 * 1024 ** 3, maxRatio: 1000 };

export interface ArchiveEntry {
  name: string;
  kind: 'file' | 'directory' | 'symlink' | 'hardlink' | 'other';
  size?: number;
  compressedSize?: number;
  modifiedMs?: number;
  /** Set when the entry would be refused on extraction. */
  unsafe?: string;
  /** The entry's data is encrypted; reading it needs the archive password. */
  encrypted?: boolean;
}

export interface ArchiveListing {
  format: ArchiveFormat;
  supported: boolean;
  entries: ArchiveEntry[];
  totalSize: number;
  archiveSize: number;
  warnings: string[];
  /** Some entries (or the whole archive) are password-protected. */
  encrypted?: boolean;
  /** A password was given and was checked against an encrypted entry. */
  passwordChecked?: boolean;
}

/**
 * Validate a password received from outside (operation params). Returns
 * undefined when none was given. The error never echoes the value.
 */
export function readPassword(value: unknown, operation: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value || value.length > ARCHIVE_PASSWORD_MAX || value.includes('\0')) {
    throw makeError('validation', operation, { message: `The password must be 1 to ${ARCHIVE_PASSWORD_MAX} characters and cannot contain a null character.` });
  }
  return value;
}

export async function detectFormat(p: string): Promise<ArchiveFormat> {
  const h = await readHead(p, 512);
  if (h.length >= 4 && h[0] === 0x50 && h[1] === 0x4b && (h[2] === 3 || h[2] === 5 || h[2] === 7)) return 'zip';
  if (h[0] === 0x1f && h[1] === 0x8b) {
    // Peek inside the gzip stream for a tar header.
    try {
      const inner = await gunzipHead(p, 512);
      if (inner.length >= 262 && inner.subarray(257, 262).toString('latin1') === 'ustar') return 'tar.gz';
    } catch {
      /* corrupt gzip: still gzip */
    }
    return 'gzip';
  }
  if (h.length >= 262 && h.subarray(257, 262).toString('latin1') === 'ustar') return 'tar';
  if (h.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) return '7z';
  if (h.subarray(0, 4).toString('latin1') === 'Rar!') return 'rar';
  if (h.subarray(0, 6).equals(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]))) return 'xz';
  if (h.subarray(0, 3).toString('latin1') === 'BZh') return 'bzip2';
  if (h.readUInt32LE?.(0) === 0xfd2fb528) return 'zstd';
  return 'unknown';
}

async function gunzipHead(p: string, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let len = 0;
    const src = fs.createReadStream(p, { end: 64 * 1024 });
    const gz = zlib.createGunzip();
    gz.on('data', (c: Buffer) => {
      chunks.push(c);
      len += c.length;
      if (len >= n) {
        src.destroy();
        gz.destroy();
        resolve(Buffer.concat(chunks).subarray(0, n));
      }
    });
    gz.on('end', () => resolve(Buffer.concat(chunks)));
    gz.on('error', (e) => (len > 0 ? resolve(Buffer.concat(chunks)) : reject(e)));
    src.pipe(gz);
  });
}

/** Validate an archive entry path. Returns the reason it is unsafe, or undefined. */
export function entryPathProblem(name: string): string | undefined {
  if (!name) return 'Empty entry name.';
  if (name.includes('\0')) return 'Entry name contains a null character.';
  const norm = name.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm) || norm.startsWith('//')) return 'Absolute path entries are not extracted.';
  const parts = norm.split('/').filter((s) => s !== '' && s !== '.');
  if (parts.some((s) => s === '..')) return 'Entries containing ".." are not extracted.';
  for (const s of parts) {
    const v = validateName(s);
    if (!v.valid) return `Invalid name segment "${s}": ${v.reason}`;
  }
  return undefined;
}

/** Resolve an entry under the destination, or throw if it escapes. */
export function safeJoin(dest: string, name: string): string {
  const problem = entryPathProblem(name);
  if (problem) throw makeError('validation', 'archive.extract', { message: problem, target: name });
  const target = path.resolve(dest, ...name.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.'));
  if (!isWithin(dest, target)) throw makeError('validation', 'archive.extract', { message: 'Entry would be written outside the destination.', target: name });
  return target;
}

function decodeZipName(entry: yauzl.Entry): string {
  const raw = (entry as unknown as { fileNameRaw?: Buffer }).fileNameRaw;
  if (!raw) return entry.fileName;
  try {
    return (yauzl as unknown as { getFileNameLowLevel: (f: number, b: Buffer, e: unknown, s: boolean) => string }).getFileNameLowLevel(
      entry.generalPurposeBitFlag,
      raw,
      (entry as unknown as { extraFields?: unknown }).extraFields ?? [],
      false,
    );
  } catch {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      return raw.toString('latin1');
    }
  }
}

function zipKind(entry: yauzl.Entry, name: string): ArchiveEntry['kind'] {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const type = unixMode & 0o170000;
  if (type === 0o120000) return 'symlink';
  if (name.endsWith('/') || type === 0o040000) return 'directory';
  return 'file';
}

function openZip(p: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(p, { lazyEntries: true, autoClose: false, decodeStrings: false, validateEntrySizes: true, strictFileNames: false } as yauzl.Options, (err, zf) => (err || !zf ? reject(err) : resolve(zf))),
  );
}

async function listZip(p: string, limits: ArchiveLimits): Promise<{ entries: ArchiveEntry[]; warnings: string[] }> {
  const zf = await openZip(p);
  const entries: ArchiveEntry[] = [];
  const warnings: string[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      zf.on('entry', (e: yauzl.Entry) => {
        if (entries.length >= limits.maxEntries) {
          warnings.push(`Listing stopped at ${limits.maxEntries.toLocaleString()} entries.`);
          resolve();
          return;
        }
        const name = decodeZipName(e);
        const kind = zipKind(e, name);
        const entry: ArchiveEntry = {
          name,
          kind,
          size: kind === 'file' ? e.uncompressedSize : undefined,
          compressedSize: e.compressedSize,
          modifiedMs: e.getLastModDate().getTime(),
        };
        const problem = entryPathProblem(name);
        if (problem) entry.unsafe = problem;
        else if (kind === 'symlink') entry.unsafe = 'Links inside archives are not extracted.';
        if (e.isEncrypted()) entry.encrypted = true;
        entries.push(entry);
        zf.readEntry();
      });
      zf.on('end', () => resolve());
      zf.on('error', reject);
      zf.readEntry();
    });
  } finally {
    zf.close();
  }
  return { entries, warnings };
}

async function listTar(p: string, limits: ArchiveLimits): Promise<{ entries: ArchiveEntry[]; warnings: string[] }> {
  const entries: ArchiveEntry[] = [];
  const warnings: string[] = [];
  await tar.t({
    file: p,
    onReadEntry: (e: tar.ReadEntry) => {
      if (entries.length >= limits.maxEntries) return;
      const kind: ArchiveEntry['kind'] = e.type === 'Directory' ? 'directory' : e.type === 'SymbolicLink' ? 'symlink' : e.type === 'Link' ? 'hardlink' : e.type === 'File' || e.type === 'OldFile' || e.type === 'ContiguousFile' ? 'file' : 'other';
      const entry: ArchiveEntry = { name: e.path, kind, size: kind === 'file' ? e.size : undefined, modifiedMs: e.mtime?.getTime() };
      const problem = entryPathProblem(e.path);
      if (problem) entry.unsafe = problem;
      else if (kind === 'symlink' || kind === 'hardlink') entry.unsafe = 'Links inside archives are not extracted.';
      else if (kind === 'other') entry.unsafe = 'Special entries (devices, pipes) are not extracted.';
      entries.push(entry);
    },
  } as tar.TarOptionsWithAliasesFile);
  if (entries.length >= limits.maxEntries) warnings.push(`Listing stopped at ${limits.maxEntries.toLocaleString()} entries.`);
  return { entries, warnings };
}

export interface ListOptions {
  /** Password for encrypted archives; when given, it is checked against the smallest encrypted entry. */
  password?: string;
  signal?: AbortSignal;
}

export async function listArchive(p: string, limits: ArchiveLimits = DEFAULT_LIMITS, opts: ListOptions = {}): Promise<ArchiveListing> {
  const listing = await listArchiveInner(p, limits, opts);
  const encrypted = listing.entries.filter((e) => e.encrypted);
  if (!encrypted.length) return listing;
  listing.encrypted = true;
  if (!sevenZipAvailable()) {
    for (const e of encrypted) e.unsafe ??= 'Encrypted entries need the bundled 7-Zip component, which is not available.';
    return listing;
  }
  if (opts.password !== undefined && listing.format === '7z' && (await sevenZipHeaderEncrypted(p))) {
    listing.passwordChecked = true; // the encrypted file list was read with it
  } else if (opts.password !== undefined) {
    // Check the password on the smallest encrypted file, so a wrong one is reported now rather than mid-extraction.
    const probe = encrypted.filter((e) => e.kind === 'file' && !e.unsafe).sort((a, b) => (a.compressedSize ?? a.size ?? 0) - (b.compressedSize ?? b.size ?? 0))[0];
    if (probe) {
      const r = await test7z(p, { password: opts.password, names: [probe.name], signal: opts.signal });
      if (r.passwordProblem) throw passwordError('archive.list', p, true, r.errors);
      listing.passwordChecked = true;
    }
  }
  return listing;
}

async function listArchiveInner(p: string, limits: ArchiveLimits, opts: ListOptions): Promise<ArchiveListing> {
  const st = await fsp.stat(p).catch((err) => {
    throw toOrbisError(err, 'archive.list', p, 'no');
  });
  const format = await detectFormat(p);
  const base = { format, archiveSize: st.size, warnings: [] as string[] };
  try {
    if (format === 'zip') {
      const { entries, warnings } = await listZip(p, limits);
      return { ...base, supported: true, entries, totalSize: sum(entries), warnings };
    }
    if (format === 'tar' || format === 'tar.gz') {
      const { entries, warnings } = await listTar(p, limits);
      return { ...base, supported: true, entries, totalSize: sum(entries), warnings };
    }
    if (format === 'gzip') {
      const inner = path.basename(p).replace(/\.gz$/i, '') || 'file';
      return { ...base, supported: true, entries: [{ name: inner, kind: 'file' }], totalSize: 0, warnings: ['The uncompressed size of a gzip file is only known after decompressing it.'] };
    }
    if ((format === '7z' || format === 'rar') && sevenZipAvailable()) {
      const r = await list7z(p, { password: opts.password, signal: opts.signal });
      const entries: ArchiveEntry[] = r.entries.slice(0, limits.maxEntries).map((e) => {
        const entry: ArchiveEntry = { name: e.name, kind: e.kind, size: e.size, compressedSize: e.compressedSize, modifiedMs: e.modifiedMs };
        const problem = entryPathProblem(e.name);
        if (problem) entry.unsafe = problem;
        else if (e.kind === 'symlink') entry.unsafe = 'Links inside archives are not extracted.';
        else if (e.kind === 'other') entry.unsafe = 'Special entries are not extracted.';
        if (e.encrypted) entry.encrypted = true;
        return entry;
      });
      const warnings = [...r.errors];
      if (r.entries.length > limits.maxEntries) warnings.push(`Listing stopped at ${limits.maxEntries.toLocaleString()} entries.`);
      return { ...base, supported: true, entries, totalSize: sum(entries), warnings };
    }
    if (STREAM_FORMATS.has(format) && sevenZipAvailable()) return listStream(p, format, st, limits, base);
  } catch (err) {
    if (err instanceof OrbisError) throw err;
    throw makeError('validation', 'archive.list', { message: `The archive appears to be damaged: ${(err as Error).message}`, target: p });
  }
  return { ...base, supported: false, entries: [], totalSize: 0, warnings: [format === 'unknown' ? 'This file is not a recognised archive.' : `${format.toUpperCase()} archives are recognised but not supported for browsing or extraction.`] };
}

const STREAM_FORMATS = new Set<ArchiveFormat>(['xz', 'bzip2', 'zstd']);

/** Name of the file inside a single compressed stream (archive.tar.xz → archive.tar). */
export function streamInnerName(archive: string): string {
  const base = path.basename(archive);
  const m = /^(.*)\.(txz|tbz2?|tzst)$/i.exec(base);
  if (m) return `${m[1]}.tar`;
  return base.replace(/\.(xz|bz2|bzip2|zst|zstd)$/i, '') || 'file';
}

const streamListCache = new Map<string, ArchiveListing>();

/** Private scratch folders for listing and nested-archive browsing; removed on exit. */
export const scratchRoot = path.join(os.tmpdir(), `orbis-files-scratch-${process.pid}`);
export async function cleanupScratch(): Promise<void> {
  await fsp.rm(scratchRoot, { recursive: true, force: true }).catch(() => undefined);
}

async function listStream(p: string, format: ArchiveFormat, st: fs.Stats, limits: ArchiveLimits, base: { format: ArchiveFormat; archiveSize: number; warnings: string[] }): Promise<ArchiveListing> {
  const key = `${p}|${st.size}|${st.mtimeMs}`;
  const cached = streamListCache.get(key);
  if (cached) return cached;
  const inner = streamInnerName(p);
  const single: ArchiveListing = { ...base, supported: true, entries: [{ name: inner, kind: 'file' }], totalSize: 0, warnings: [`A single compressed ${format.toUpperCase()} stream. Its uncompressed size is only known after decompressing it.`] };
  // Look inside small streams to show the files of a .tar.xz/.tar.bz2/.tar.zst.
  if (!/\.tar$/i.test(inner) || st.size > 512 * 1024 * 1024) return single;
  const dir = path.join(scratchRoot, `list-${crypto.randomUUID()}`);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    const innerFile = await decompressStream(p, dir, { ...limits, maxTotalBytes: Math.min(limits.maxTotalBytes, 4 * 1024 ** 3) }, st.size);
    if ((await detectFormat(innerFile)) !== 'tar') return single;
    const { entries, warnings } = await listTar(innerFile, limits);
    const out: ArchiveListing = { ...base, supported: true, entries, totalSize: sum(entries), warnings: [`${format.toUpperCase()}-compressed TAR archive.`, ...warnings] };
    streamListCache.set(key, out);
    if (streamListCache.size > 50) streamListCache.delete(streamListCache.keys().next().value!);
    return out;
  } catch (err) {
    if (err instanceof OrbisError && err.shape.category === 'validation') throw err;
    return { ...single, warnings: [...single.warnings, `The contents could not be listed: ${(err as Error).message}`] };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Total size of regular files under a directory (no link following). */
async function treeBytes(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        files++;
        bytes += (await fsp.lstat(p).catch(() => undefined))?.size ?? 0;
      }
    }
  }
  return { bytes, files };
}

/**
 * Run a 7-Zip extraction into `outDir` while watching how much it writes. The
 * job is stopped as soon as the output passes the size or ratio limit.
 */
async function guardedExtract7z(archive: string, outDir: string, limits: ArchiveLimits, archiveSize: number, opts: { names?: string[]; signal?: AbortSignal; onBytes?: (total: number) => void; password?: string; operation?: string } = {}): Promise<{ errors: string[] }> {
  const operation = opts.operation ?? 'archive.extract';
  const ac = new AbortController();
  const onOuterAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });
  let limitError: Error | undefined;
  const check = (bytes: number) => {
    try {
      new LimitMeter(limits, archiveSize).add(bytes);
    } catch (err) {
      limitError = err as Error;
      ac.abort();
    }
  };
  const timer = setInterval(() => {
    void treeBytes(outDir).then(({ bytes }) => {
      opts.onBytes?.(bytes);
      check(bytes);
    });
  }, 400);
  try {
    const r = await extract7z(archive, outDir, { names: opts.names, signal: ac.signal, password: opts.password }).catch((err) => {
      if (limitError) throw limitError;
      throw err;
    });
    const { bytes } = await treeBytes(outDir);
    check(bytes);
    if (limitError) throw limitError;
    opts.onBytes?.(bytes);
    // A wrong password can still leave files in the staging folder (ZIP); the caller discards it.
    if (r.passwordProblem) throw passwordError(operation, archive, opts.password !== undefined, r.errors);
    if (r.code !== 0 && r.code !== 1) {
      const msg = scrubSecret(r.errors[0] ?? '7-Zip reported an error.', opts.password);
      throw makeError('validation', operation, { target: archive, message: `The archive appears to be damaged: ${msg.replace(/^ERROR:\s*/, '')}` });
    }
    return { errors: r.errors };
  } finally {
    clearInterval(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}

/** Decompress a single XZ/BZIP2/ZSTD stream into `outDir`; returns the inner file. */
async function decompressStream(archive: string, outDir: string, limits: ArchiveLimits, archiveSize: number, signal?: AbortSignal, onBytes?: (n: number) => void): Promise<string> {
  await guardedExtract7z(archive, outDir, limits, archiveSize, { signal, onBytes });
  const items = (await fsp.readdir(outDir, { withFileTypes: true })).filter((e) => e.isFile());
  if (items.length !== 1) throw makeError('validation', 'archive.extract', { target: archive, message: 'The compressed stream did not contain exactly one file.' });
  return path.join(outDir, items[0]!.name);
}

/**
 * Move an extracted tree from a private temporary folder into the destination.
 * Links and special files are dropped, names are re-validated, and existing
 * items go through the normal conflict questions.
 */
async function commitExtracted(tmpRoot: string, dest: string, rec: OperationRecord, ctx: RunContext, helpers: RunnerHelpers, wanted?: (rel: string) => boolean): Promise<void> {
  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      await ctx.gate();
      const src = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      const st = await fsp.lstat(src);
      const problem = entryPathProblem(r);
      if (problem || (!st.isFile() && !st.isDirectory())) {
        rec.results.push({ source: r, status: 'skipped', error: { category: 'validation', operation: 'archive.extract', message: problem ?? (st.isSymbolicLink() ? 'Links inside archives are not extracted.' : 'Special entries are not extracted.'), dataChanged: 'no', retryable: false, target: r } });
        continue;
      }
      const target = safeJoin(dest, r);
      if (st.isDirectory()) {
        const existing = await fsp.lstat(target).catch(() => undefined);
        if (existing && !existing.isDirectory()) {
          rec.results.push({ source: r, status: 'failed', error: { category: 'already_exists', operation: 'archive.extract', message: 'A file with this folder\'s name already exists; the folder was not extracted.', dataChanged: 'no', retryable: false, target } });
          continue;
        }
        if (!existing) await fsp.mkdir(target);
        await walk(src, r);
        continue;
      }
      if (wanted && !wanted(r)) continue;
      try {
        let finalTarget = target;
        const existing = await fsp.lstat(target).catch(() => undefined);
        if (existing) {
          const action = await helpers.ask({ source: e.name, destination: target, sourceKind: 'file', destinationKind: existing.isDirectory() ? 'directory' : 'file', sourceSize: st.size, destinationSize: existing.isFile() ? existing.size : undefined, destinationModifiedMs: existing.mtimeMs, sourceModifiedMs: st.mtimeMs, suggestedName: await uniqueName(path.dirname(target), e.name, exists), remaining: 0 });
          if (action === 'skip' || action === 'merge') {
            rec.results.push({ source: r, destination: target, status: 'skipped' });
            continue;
          }
          if (action === 'keep-both') finalTarget = path.join(path.dirname(target), await uniqueName(path.dirname(target), e.name, exists));
          else if (action === 'replace' && existing.isDirectory()) throw makeError('is_a_directory', 'archive.extract', { message: 'A folder with this name exists; it was not replaced.', target });
          else if (action === 'replace') {
            await fsp.rename(src, finalTarget);
            rec.results.push({ source: r, destination: finalTarget, status: 'done' });
            helpers.tick(0, 1, e.name);
            continue;
          }
        }
        await fsp.link(src, finalTarget); // fails instead of overwriting something that appeared meanwhile
        await fsp.unlink(src);
        rec.results.push({ source: r, destination: finalTarget, status: 'done' });
        helpers.tick(0, 1, e.name);
      } catch (err) {
        const shape = toOrbisError(err, 'archive.extract', r);
        if (shape.category === 'cancelled') throw err;
        rec.results.push({ source: r, status: 'failed', error: shape });
      }
    }
  };
  await walk(tmpRoot, '');
}

function sum(entries: ArchiveEntry[]): number {
  return entries.reduce((a, e) => a + (e.size ?? 0), 0);
}

/** Counts decompressed bytes and aborts when limits are exceeded. */
class LimitMeter {
  total = 0;
  constructor(private readonly limits: ArchiveLimits, private readonly archiveSize: number) {}
  add(n: number): void {
    this.total += n;
    if (this.total > this.limits.maxTotalBytes) throw makeError('validation', 'archive.extract', { message: `Extraction stopped: the archive expands beyond the ${Math.round(this.limits.maxTotalBytes / 1024 ** 3)} GB safety limit.` });
    if (this.archiveSize > 0 && this.total > 1024 * 1024 && this.total / this.archiveSize > this.limits.maxRatio) {
      throw makeError('validation', 'archive.extract', { message: `Extraction stopped: the archive expands more than ${this.limits.maxRatio}× its size, which suggests a decompression bomb.` });
    }
  }
}

interface ExtractParams {
  /** Entry names to extract; all safe entries when omitted. */
  selected?: string[];
  /** Create a folder named after the archive inside the destination. */
  subfolder?: boolean;
  limits?: Partial<ArchiveLimits>;
  /** Password for encrypted archives (memory only; never stored in the operation record). */
  password?: string;
}

async function writeEntry(stream: Readable, target: string, ctx: RunContext, helpers: RunnerHelpers, meter: LimitMeter, mtime?: Date): Promise<'done' | 'skipped'> {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  let finalTarget = target;
  if (await exists(target)) {
    const st = await fsp.lstat(target);
    const action = await helpers.ask({
      source: path.basename(target),
      destination: target,
      sourceKind: 'file',
      destinationKind: st.isDirectory() ? 'directory' : 'file',
      destinationSize: st.isFile() ? st.size : undefined,
      destinationModifiedMs: st.mtimeMs,
      suggestedName: await uniqueName(path.dirname(target), path.basename(target), exists),
      remaining: 0,
    });
    if (action === 'skip' || action === 'merge') {
      stream.resume();
      return 'skipped';
    }
    if (action === 'keep-both') finalTarget = path.join(path.dirname(target), await uniqueName(path.dirname(target), path.basename(target), exists));
    else if (action === 'replace' && st.isDirectory()) throw makeError('is_a_directory', 'archive.extract', { message: 'A folder with this name exists; it was not replaced.', target });
  }
  const tmp = path.join(path.dirname(finalTarget), `.orbis-part-${crypto.randomUUID()}`);
  helpers.temp(tmp);
  const meterT = new Transform({
    transform(chunk: Buffer, _e, cb) {
      ctx.gate().then(
        () => {
          try {
            meter.add(chunk.length);
          } catch (err) {
            cb(err as Error);
            return;
          }
          helpers.tick(chunk.length, 0, path.basename(finalTarget));
          cb(null, chunk);
        },
        (err) => cb(err),
      );
    },
  });
  await pipeline(stream, meterT, fs.createWriteStream(tmp, { flags: 'wx', mode: 0o644 }), { signal: ctx.signal });
  if (mtime) await fsp.utimes(tmp, mtime, mtime).catch(() => undefined);
  if (finalTarget !== target || !(await exists(finalTarget))) {
    try {
      await fsp.link(tmp, finalTarget);
      await fsp.unlink(tmp);
    } catch (err) {
      if ((err as { code?: string }).code === 'EEXIST') throw makeError('already_exists', 'archive.extract', { target: finalTarget });
      await fsp.rename(tmp, finalTarget);
    }
  } else {
    await fsp.rename(tmp, finalTarget); // explicit replace
  }
  helpers.committed(tmp);
  helpers.tick(0, 1);
  return 'done';
}

type EntryHandler = (name: string, kind: ArchiveEntry['kind'], open: () => Promise<Readable>, mtime?: Date) => Promise<void>;

async function extractTarFile(file: string, safeNames: Set<string>, handle: EntryHandler): Promise<void> {
  const queue: Array<Promise<void>> = [];
  let failure: unknown;
  await tar.t({
    file,
    noResume: true,
    onReadEntry: (e: tar.ReadEntry) => {
      const kind: ArchiveEntry['kind'] = e.type === 'Directory' ? 'directory' : e.type === 'File' || e.type === 'OldFile' || e.type === 'ContiguousFile' ? 'file' : 'other';
      if (failure || !safeNames.has(e.path) || (kind !== 'file' && kind !== 'directory')) {
        e.resume();
        return;
      }
      if (kind === 'directory') e.resume();
      const p = handle(e.path, kind, async () => e as unknown as Readable, e.mtime).catch((err) => {
        failure = err;
        e.resume();
      });
      queue.push(p);
    },
  } as tar.TarOptionsWithAliasesFile);
  await Promise.all(queue);
  if (failure) throw failure;
}

/** Combine configured limits with per-request limits; a request can only tighten them. */
export function effectiveLimits(configured: Partial<ArchiveLimits> | undefined, requested: Partial<ArchiveLimits> | undefined): ArchiveLimits {
  const base = { ...DEFAULT_LIMITS, ...(configured ?? {}) };
  const r = requested ?? {};
  return {
    maxEntries: Math.min(base.maxEntries, r.maxEntries ?? Infinity),
    maxTotalBytes: Math.min(base.maxTotalBytes, r.maxTotalBytes ?? Infinity),
    maxRatio: Math.min(base.maxRatio, r.maxRatio ?? Infinity),
  };
}

export function makeExtractRunner(markRunning: (rec: OperationRecord) => void, getLimits?: () => Partial<ArchiveLimits>): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const archive = rec.sources[0];
    if (!archive || rec.sources.length !== 1) throw makeError('validation', 'archive.extract', { message: 'Extract one archive at a time.' });
    const params = (req.params ?? {}) as ExtractParams;
    const password = readPassword(params.password, 'archive.extract');
    const limits = effectiveLimits(getLimits?.(), params.limits);
    const listing = await listArchive(archive, limits, { password, signal: ctx.signal });
    if (!listing.supported) throw makeError('unsupported', 'archive.extract', { message: listing.warnings[0] ?? 'Unsupported archive.' });
    const wanted = params.selected ? new Set(params.selected) : undefined;
    const isWanted = (n: string) => !wanted || wanted.has(n) || [...wanted].some((w) => w.endsWith('/') && n.startsWith(w));
    const plan = listing.entries.filter((e) => isWanted(e.name));
    const safe = plan.filter((e) => !e.unsafe);
    const needsKey = safe.some((e) => e.encrypted);
    // Ask for the password before anything is created in the destination.
    if (needsKey && password === undefined) throw passwordError('archive.extract', archive, false);
    for (const e of plan) if (e.unsafe) rec.results.push({ source: e.name, status: 'skipped', error: { category: 'validation', operation: 'archive.extract', message: e.unsafe, dataChanged: 'no', retryable: false, target: e.name } });
    let dest = rec.destination!;
    if (params.subfolder) {
      const base = path.basename(archive).replace(/\.(tar\.(gz|xz|bz2|zst)|zip|tar|tgz|txz|tbz2?|tzst|gz|7z|rar|xz|bz2|zst)$/i, '') || 'archive';
      const name = (await exists(path.join(dest, base))) ? await uniqueName(dest, base, exists) : base;
      dest = path.join(dest, name);
      await fsp.mkdir(dest, { recursive: true });
    }
    // Encrypted ZIP entries (ZipCrypto or AES) are decrypted by 7-Zip.
    const zipVia7z = listing.format === 'zip' && needsKey;
    rec.progress = { totalItems: safe.length, totalBytes: listing.format === 'gzip' ? undefined : safe.reduce((a, e) => a + (e.size ?? 0), 0), completedItems: 0, completedBytes: 0 };
    markRunning(rec);
    const meter = new LimitMeter(limits, listing.archiveSize);
    const safeNames = new Set(safe.map((e) => e.name));

    const handle = async (name: string, kind: ArchiveEntry['kind'], open: () => Promise<Readable>, mtime?: Date) => {
      if (!safeNames.has(name)) return;
      try {
        const target = safeJoin(dest, name);
        if (kind === 'directory') {
          await fsp.mkdir(target, { recursive: true });
          helpers.tick(0, 1);
          rec.results.push({ source: name, destination: target, status: 'done' });
          return;
        }
        const status = await writeEntry(await open(), target, ctx, helpers, meter, mtime);
        rec.results.push({ source: name, destination: target, status });
      } catch (err) {
        const shape = toOrbisError(err, 'archive.extract', name);
        if (shape.category === 'cancelled' || ctx.signal.aborted) throw err;
        rec.results.push({ source: name, status: 'failed', error: shape });
        if (/safety limit|decompression bomb/.test(shape.message)) throw err;
      }
    };

    const totalDeclared = safe.reduce((a, e) => a + (e.size ?? 0), 0);
    // Refuse up front when the archive's own header already declares too much.
    if (safe.length > limits.maxEntries) throw makeError('validation', 'archive.extract', { message: `The archive has more than ${limits.maxEntries.toLocaleString()} entries, which exceeds the safety limit.` });
    new LimitMeter(limits, listing.archiveSize).add(totalDeclared);

    if (listing.format === '7z' || listing.format === 'rar' || zipVia7z || STREAM_FORMATS.has(listing.format)) {
      const tmp = path.join(dest, `.orbis-part-${crypto.randomUUID()}`);
      helpers.temp(tmp);
      await fsp.mkdir(tmp);
      let reported = 0;
      const onBytes = (n: number) => {
        if (n > reported) {
          helpers.tick(n - reported, 0);
          reported = n;
        }
      };
      if (listing.format === '7z' || listing.format === 'rar' || zipVia7z) {
        const all = listing.entries.length === safe.length && !wanted;
        const names = all ? undefined : safe.filter((e) => e.kind === 'file').map((e) => e.name);
        if (names && !names.length) {
          await fsp.rm(tmp, { recursive: true, force: true });
          helpers.committed(tmp);
          return;
        }
        await guardedExtract7z(archive, tmp, limits, listing.archiveSize, { names, signal: ctx.signal, onBytes, password });
        await commitExtracted(tmp, dest, rec, ctx, helpers);
      } else {
        const innerDir = path.join(tmp, 'stream');
        await fsp.mkdir(innerDir);
        const inner = await decompressStream(archive, innerDir, limits, listing.archiveSize, ctx.signal, onBytes);
        if ((await detectFormat(inner)) === 'tar') {
          await extractTarFile(inner, safeNames, handle);
        } else {
          const named = path.join(innerDir, streamInnerName(archive));
          if (named !== inner) await fsp.rename(inner, named);
          await commitExtracted(innerDir, dest, rec, ctx, helpers);
        }
      }
      await fsp.rm(tmp, { recursive: true, force: true });
      helpers.committed(tmp);
      return;
    }

    if (listing.format === 'zip') {
      const zf = await openZip(archive);
      try {
        await new Promise<void>((resolve, reject) => {
          zf.on('entry', (e: yauzl.Entry) => {
            const name = decodeZipName(e);
            const kind = zipKind(e, name);
            handle(name, kind, () => new Promise((res, rej) => zf.openReadStream(e, (err, s) => (err || !s ? rej(err) : res(s)))), e.getLastModDate())
              .then(() => zf.readEntry())
              .catch(reject);
          });
          zf.on('end', resolve);
          zf.on('error', reject);
          zf.readEntry();
        });
      } finally {
        zf.close();
      }
    } else if (listing.format === 'tar' || listing.format === 'tar.gz') {
      await extractTarFile(archive, safeNames, handle);
    } else if (listing.format === 'gzip') {
      const name = listing.entries[0]!.name;
      await handle(name, 'file', async () => fs.createReadStream(archive).pipe(zlib.createGunzip()));
    }
  };
}

export type CompressFormat = 'zip' | 'tar' | 'tar.gz' | '7z';
const COMPRESS_EXT: Record<CompressFormat, string> = { zip: '.zip', tar: '.tar', 'tar.gz': '.tar.gz', '7z': '.7z' };

/**
 * Create an archive (ZIP, TAR, TAR.GZ or 7Z) from sources. Links are never
 * followed or stored; they are reported as skipped. The archive is written to
 * a temporary sibling and committed without overwriting unless the user chose
 * Replace. ZIP and 7Z can be password-protected (AES-256, through 7-Zip; for
 * 7Z the file names can be encrypted too).
 */
export function makeCompressRunner(markRunning: (rec: OperationRecord) => void): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const params = (req.params ?? {}) as { name?: string; format?: CompressFormat; level?: number; password?: unknown; encryptNames?: boolean };
    const format: CompressFormat = params.format && params.format in COMPRESS_EXT ? params.format : 'zip';
    const password = readPassword(params.password, 'archive.compress');
    if (password !== undefined && format !== 'zip' && format !== '7z') throw makeError('validation', 'archive.compress', { message: 'Only ZIP and 7Z archives can be password-protected.' });
    // 7-Zip only encrypts ZIP archives with printable ASCII passwords (other tools disagree on how to encode the rest).
    if (password !== undefined && format === 'zip' && !/^[\x20-\x7e]+$/.test(password)) throw makeError('validation', 'archive.compress', { message: 'ZIP passwords can only use unaccented letters, digits, spaces and common symbols. Choose 7Z for other characters.' });
    if ((format === '7z' || password !== undefined) && !sevenZipAvailable()) throw makeError('unavailable', 'archive.compress', { message: 'The 7-Zip component is not available.' });
    const ext = COMPRESS_EXT[format];
    const raw = String(params.name ?? `Archive${ext}`);
    const name = raw.toLowerCase().endsWith(ext) ? raw : `${raw}${ext}`;
    const v = validateName(name);
    if (!v.valid) throw makeError('invalid_name', 'archive.compress', { message: v.reason });
    const dest = rec.destination!;
    let target = path.join(dest, name);
    let replace = false;
    if (await exists(target)) {
      const action = await helpers.ask({ source: name, destination: target, sourceKind: 'file', destinationKind: 'file', suggestedName: await uniqueName(dest, path.basename(target), exists), remaining: 0 });
      if (action === 'skip' || action === 'merge') {
        rec.results.push({ source: rec.sources[0]!, destination: target, status: 'skipped' });
        return;
      }
      if (action === 'keep-both') target = path.join(dest, await uniqueName(dest, path.basename(target), exists));
      if (action === 'replace') replace = true;
    }
    // Collect files (no symlink following). All sources share one parent folder for relative names.
    const base = path.dirname(rec.sources[0]!);
    if (rec.sources.some((src) => path.dirname(src) !== base)) throw makeError('validation', 'archive.compress', { message: 'Items to compress must be in the same folder.' });
    const files: Array<{ abs: string; rel: string; size: number; mtime: Date; dir: boolean; empty?: boolean }> = [];
    for (const src of rec.sources) {
      const stack = [src];
      while (stack.length) {
        await ctx.gate();
        const p = stack.pop()!;
        const st = await fsp.lstat(p);
        const rel = path.relative(base, p).split(path.sep).join('/');
        if (st.isSymbolicLink()) {
          rec.results.push({ source: p, status: 'skipped', error: { category: 'unsupported', operation: 'archive.compress', message: 'Links are not added to archives.', dataChanged: 'no', retryable: false, target: p } });
          continue;
        }
        if (st.isDirectory()) {
          const children = (await fsp.readdir(p)).filter((c) => !c.startsWith('.orbis-part-'));
          files.push({ abs: p, rel: `${rel}/`, size: 0, mtime: st.mtime, dir: true, empty: children.length === 0 });
          for (const c of children) stack.push(path.join(p, c));
        } else if (st.isFile()) files.push({ abs: p, rel, size: st.size, mtime: st.mtime, dir: false });
      }
    }
    const measurable = format === 'zip' && password === undefined;
    rec.progress = { totalItems: files.length, totalBytes: measurable ? files.reduce((a, f) => a + f.size, 0) : undefined, completedItems: 0, completedBytes: 0 };
    markRunning(rec);
    const tmp = path.join(dest, `.orbis-part-${crypto.randomUUID()}${ext}`);
    helpers.temp(tmp);
    if (format === 'zip' && password === undefined) {
      const store = params.level === 0;
      const zip = new yazl.ZipFile();
      const out = fs.createWriteStream(tmp, { flags: 'wx' });
      const done = pipeline(zip.outputStream, out, { signal: ctx.signal });
      for (const f of files) {
        await ctx.gate();
        if (f.dir) zip.addEmptyDirectory(f.rel, { mtime: f.mtime });
        else {
          const counter = new Transform({
            transform(chunk: Buffer, _e, cb) {
              helpers.tick(chunk.length, 0, path.basename(f.abs));
              cb(null, chunk);
            },
          });
          zip.addReadStream(fs.createReadStream(f.abs).pipe(counter), f.rel, { mtime: f.mtime, size: f.size, compress: !store });
        }
        helpers.tick(0, 1);
      }
      zip.end();
      await done;
    } else if (format === 'tar' || format === 'tar.gz') {
      const level = Math.max(1, Math.min(9, Math.round(params.level ?? 6)));
      await tar.c(
        {
          file: tmp,
          cwd: base,
          gzip: format === 'tar.gz' ? { level } : undefined,
          portable: true,
          noDirRecurse: true,
          follow: false,
          onWriteEntry: (e: { path: string }) => helpers.tick(0, 1, e.path),
        } as unknown as tar.TarOptionsWithAliasesFile,
        files.map((f) => f.rel.replace(/\/$/, '')),
      );
      await ctx.gate();
    } else {
      // Regular files plus empty folders; non-empty folders come along with their files.
      const rels = files.filter((f) => !f.dir || f.empty).map((f) => f.rel.replace(/\/$/, ''));
      await create7z(tmp, base, rels, params.level ?? 5, { signal: ctx.signal, type: format === 'zip' ? 'zip' : '7z', password, encryptNames: params.encryptNames !== false });
      await fsp.chmod(tmp, 0o644).catch(() => undefined);
      helpers.tick(0, files.length);
    }
    if (replace) await fsp.rename(tmp, target); // the user chose to replace the existing archive
    else {
      try {
        await fsp.link(tmp, target);
        await fsp.unlink(tmp);
      } catch (err) {
        if ((err as { code?: string }).code === 'EEXIST') throw makeError('already_exists', 'archive.compress', { message: `"${path.basename(target)}" appeared while compressing and was not overwritten.`, target });
        if (await exists(target)) throw makeError('already_exists', 'archive.compress', { target });
        await fsp.rename(tmp, target);
      }
    }
    helpers.committed(tmp);
    for (const s of rec.sources) if (!rec.results.some((r) => r.source === s)) rec.results.push({ source: s, destination: target, status: 'done' });
  };
}

/* ------------------------------------------------------------------ integrity */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32Update(crc: number, buf: Buffer): number {
  const native = (zlib as unknown as { crc32?: (b: Buffer, v?: number) => number }).crc32;
  if (native) return native(buf, crc);
  let c = ~crc >>> 0;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

export interface IntegrityReport {
  format: ArchiveFormat;
  ok: boolean;
  checked: number;
  failed: Array<{ name: string; message: string }>;
  method: string;
}

/**
 * Verify an archive's stored checksums by reading every entry (nothing is
 * written). Encrypted archives need `password`; without it (or with a wrong
 * one) a password error is thrown instead of a report.
 */
export async function testArchive(p: string, signal: AbortSignal, onProgress?: (checked: number) => void, password?: string): Promise<IntegrityReport> {
  const format = await detectFormat(p);
  const failed: IntegrityReport['failed'] = [];
  let checked = 0;
  if (format === 'zip' && sevenZipAvailable() && (await zipHasEncryptedEntries(p))) return test7zReport(p, format, signal, password);
  if (format === 'zip') {
    const zf = await openZip(p);
    try {
      await new Promise<void>((resolve, reject) => {
        zf.on('entry', (e: yauzl.Entry) => {
          if (signal.aborted) return reject(makeError('cancelled', 'archive.test'));
          const name = decodeZipName(e);
          if (name.endsWith('/') || e.isEncrypted()) {
            if (e.isEncrypted()) failed.push({ name, message: 'Encrypted entry; not verified.' });
            zf.readEntry();
            return;
          }
          zf.openReadStream(e, (err, stream) => {
            if (err || !stream) {
              failed.push({ name, message: err?.message ?? 'Unreadable entry.' });
              zf.readEntry();
              return;
            }
            let crc = 0;
            stream.on('data', (c: Buffer) => (crc = crc32Update(crc, c)));
            stream.on('error', (e2: Error) => {
              failed.push({ name, message: e2.message });
              zf.readEntry();
            });
            stream.on('end', () => {
              checked++;
              if (crc >>> 0 !== e.crc32 >>> 0) failed.push({ name, message: 'Checksum (CRC-32) does not match: the data is damaged.' });
              onProgress?.(checked);
              zf.readEntry();
            });
          });
        });
        zf.on('end', resolve);
        zf.on('error', reject);
        zf.readEntry();
      });
    } catch (err) {
      if (err instanceof OrbisError && err.shape.category === 'cancelled') throw err;
      failed.push({ name: path.basename(p), message: (err as Error).message });
    } finally {
      zf.close();
    }
    return { format, ok: failed.length === 0, checked, failed, method: 'CRC-32 of every entry' };
  }
  if (format === 'tar' || format === 'tar.gz') {
    try {
      await tar.t({
        file: p,
        strict: true,
        onReadEntry: (e: tar.ReadEntry) => {
          checked++;
          onProgress?.(checked);
          e.resume();
        },
      } as tar.TarOptionsWithAliasesFile);
    } catch (err) {
      failed.push({ name: path.basename(p), message: (err as Error).message });
    }
    return { format, ok: failed.length === 0, checked, failed, method: format === 'tar.gz' ? 'Header checksums and the gzip CRC-32' : 'Header checksums' };
  }
  if (format === 'gzip') {
    try {
      await pipeline(fs.createReadStream(p), zlib.createGunzip(), new Transform({ transform: (_c, _e, cb) => cb() }), { signal });
      checked = 1;
    } catch (err) {
      if (signal.aborted) throw makeError('cancelled', 'archive.test');
      failed.push({ name: path.basename(p), message: (err as Error).message });
    }
    return { format, ok: failed.length === 0, checked, failed, method: 'gzip CRC-32 and length' };
  }
  if (['7z', 'rar', 'xz', 'bzip2', 'zstd'].includes(format) && sevenZipAvailable()) return test7zReport(p, format, signal, password);
  throw makeError('unsupported', 'archive.test', { target: p, message: 'This file is not a supported archive.' });
}

async function test7zReport(p: string, format: ArchiveFormat, signal: AbortSignal, password?: string): Promise<IntegrityReport> {
  const r = await test7z(p, { signal, password });
  if (r.passwordProblem) throw passwordError('archive.test', p, password !== undefined, r.errors);
  return { format, ok: r.ok, checked: r.ok ? 1 : 0, failed: r.errors.map((m) => ({ name: path.basename(p), message: m.replace(/^ERROR:\s*/, '') })), method: `7-Zip integrity test (stored checksums${password !== undefined ? ', decrypted with the password' : ''})` };
}

async function zipHasEncryptedEntries(p: string): Promise<boolean> {
  try {
    return (await listZip(p, DEFAULT_LIMITS)).entries.some((e) => e.encrypted);
  } catch {
    return false; // damaged: the native test reports it
  }
}

/* ------------------------------------------------------------------ entries in scratch space */

/** Create a private (owner-only) folder for scratch copies. */
async function privateScratchDir(prefix: string): Promise<string> {
  await fsp.mkdir(scratchRoot, { recursive: true, mode: 0o700 });
  const dir = path.join(scratchRoot, `${prefix}-${crypto.randomUUID()}`);
  await fsp.mkdir(dir, { mode: 0o700 });
  return dir;
}

export interface ScratchOptions {
  /** Password for an encrypted entry (memory only). */
  password?: string;
  /**
   * 'nested' (default): the entry must itself be an archive, to browse it.
   * 'open': any regular file, to open or preview a temporary copy of it.
   */
  purpose?: 'nested' | 'open';
}

/**
 * Copy one entry out of an archive into a private scratch folder, so an
 * archive inside an archive can be browsed, or a file inside an archive can be
 * opened or previewed. Size-limited; nothing else is extracted; the folder is
 * readable by the current user only and is removed when Orbis Files quits.
 * Edits to the copy are not written back into the archive.
 */
export async function extractEntryToScratch(archive: string, entryName: string, maxBytes: number, limits: ArchiveLimits = DEFAULT_LIMITS, opts: ScratchOptions = {}): Promise<string> {
  const purpose = opts.purpose ?? 'nested';
  const op = purpose === 'open' ? 'archive.openEntry' : 'archive.nested';
  const password = readPassword(opts.password, op);
  const problem = entryPathProblem(entryName);
  if (problem) throw makeError('validation', op, { message: problem });
  const listing = await listArchive(archive, limits, { password });
  const entry = listing.entries.find((e) => e.name === entryName);
  if (!entry || entry.kind !== 'file') throw makeError('not_found', op, { message: 'That entry is not a file in this archive.' });
  if (entry.unsafe) throw makeError('validation', op, { message: entry.unsafe });
  if (entry.size !== undefined && entry.size > maxBytes) {
    throw makeError('validation', op, {
      message: purpose === 'open'
        ? `This file is larger than the ${Math.round(maxBytes / 1024 ** 2)} MB limit for opening files directly from an archive. Extract it instead.`
        : `The inner archive is larger than the ${Math.round(maxBytes / 1024 ** 2)} MB limit for browsing nested archives. Extract it instead.`,
    });
  }
  if (entry.encrypted && password === undefined) throw passwordError(op, archive, false);
  const dir = await privateScratchDir(purpose === 'open' ? 'open' : 'nested');
  const base = path.basename(entryName.replace(/\\/g, '/'));
  const out = path.join(dir, validateName(base).valid ? base : purpose === 'open' ? 'file' : 'archive');
  const scratchLimits = { ...limits, maxTotalBytes: Math.min(limits.maxTotalBytes, maxBytes) };
  const meter = new LimitMeter(scratchLimits, listing.archiveSize);
  const counter = () => new Transform({
    transform(chunk: Buffer, _e, cb) {
      try {
        meter.add(chunk.length);
        cb(null, chunk);
      } catch (err) {
        cb(err as Error);
      }
    },
  });
  try {
    if (listing.format === 'zip' && !entry.encrypted) {
      const zf = await openZip(archive);
      try {
        await new Promise<void>((resolve, reject) => {
          zf.on('entry', (e: yauzl.Entry) => {
            if (decodeZipName(e) !== entryName) return zf.readEntry();
            zf.openReadStream(e, (err, stream) => {
              if (err || !stream) return reject(err ?? new Error('Unreadable entry'));
              pipeline(stream, counter(), fs.createWriteStream(out, { flags: 'wx', mode: 0o600 })).then(resolve, reject);
            });
          });
          zf.on('end', () => reject(makeError('not_found', op)));
          zf.on('error', reject);
          zf.readEntry();
        });
      } finally {
        zf.close();
      }
    } else if (listing.format === 'tar' || listing.format === 'tar.gz') {
      let job: Promise<void> | undefined;
      await tar.t({
        file: archive,
        noResume: true,
        onReadEntry: (e: tar.ReadEntry) => {
          if (e.path !== entryName || job) return void e.resume();
          job = pipeline(e as unknown as Readable, counter(), fs.createWriteStream(out, { flags: 'wx', mode: 0o600 }));
        },
      } as tar.TarOptionsWithAliasesFile);
      if (!job) throw makeError('not_found', op);
      await job;
    } else if (listing.format === '7z' || listing.format === 'rar' || listing.format === 'zip') {
      // 7z/RAR, and encrypted ZIP entries (ZipCrypto/AES), through 7-Zip.
      const tmp = path.join(dir, 'x');
      await fsp.mkdir(tmp, { mode: 0o700 });
      await guardedExtract7z(archive, tmp, scratchLimits, listing.archiveSize, { names: [entryName], password, operation: op });
      const extracted = safeJoin(tmp, entryName);
      const st = await fsp.lstat(extracted).catch(() => undefined);
      if (!st?.isFile()) throw makeError('not_found', op, { message: 'The entry could not be read from the archive.' });
      await fsp.rename(extracted, out);
      await fsp.chmod(out, 0o600).catch(() => undefined);
      await fsp.rm(tmp, { recursive: true, force: true });
    } else if (STREAM_FORMATS.has(listing.format)) {
      const tmp = path.join(dir, 'x');
      await fsp.mkdir(tmp, { mode: 0o700 });
      const inner = await decompressStream(archive, tmp, scratchLimits, listing.archiveSize);
      const isTar = (await detectFormat(inner)) === 'tar';
      if (!isTar || entryName === streamInnerName(archive)) {
        // A single compressed file: the decompressed stream is the entry.
        if (purpose !== 'open' && !isTar) throw makeError('unsupported', op, { message: 'Only archives inside a compressed TAR can be opened here.' });
        await fsp.rename(inner, out);
        await fsp.rm(tmp, { recursive: true, force: true });
      } else {
        const result = await extractEntryToScratch(inner, entryName, maxBytes, limits, { purpose });
        await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
        return result;
      }
    } else if (listing.format === 'gzip') {
      await pipeline(fs.createReadStream(archive), zlib.createGunzip(), counter(), fs.createWriteStream(out, { flags: 'wx', mode: 0o600 }));
    } else throw makeError('unsupported', op, { message: 'Entries of this archive type cannot be opened.' });
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
  if (purpose === 'nested' && (await detectFormat(out)) === 'unknown') {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw makeError('unsupported', op, { message: 'That entry is not a recognised archive.' });
  }
  return out;
}
