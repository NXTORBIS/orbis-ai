import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { makeError } from '../../shared/errors';
import { exec7z, type SevenZipJob, type SevenZipResult } from './sevenZipCore';

/**
 * 7-Zip backend for formats Node has no maintained library for: 7z, RAR/RAR5,
 * XZ, BZIP2 and ZSTD (and their .tar variants). Jobs run in a worker thread so
 * they can be cancelled and never block the main process.
 */

let config: { wasmPath: string; workerScript?: string } | undefined;
let wasmCache: Uint8Array | undefined;

export function configureSevenZip(c: { wasmPath: string; workerScript?: string }): void {
  config = c;
  wasmCache = undefined;
}

export function sevenZipAvailable(): boolean {
  return !!config && fs.existsSync(config.wasmPath);
}

async function wasm(): Promise<Uint8Array> {
  if (!config) throw makeError('unavailable', 'archive.7z', { message: 'The 7-Zip component is not configured.' });
  wasmCache ??= new Uint8Array(await fsp.readFile(config.wasmPath));
  return wasmCache;
}

export async function run7z(job: SevenZipJob, opts: { signal?: AbortSignal; onLine?: (line: string) => void } = {}): Promise<SevenZipResult> {
  const binary = await wasm();
  if (opts.signal?.aborted) throw makeError('cancelled', 'archive.7z');
  const script = config?.workerScript && fs.existsSync(config.workerScript) ? fs.readFileSync(config.workerScript, 'utf8') : undefined;
  if (!script) return exec7z(binary, job, (l) => opts.onLine?.(l)); // tests and development fallback
  return new Promise<SevenZipResult>((resolve, reject) => {
    const worker = new Worker(script, { eval: true, workerData: { wasm: binary, job } });
    const abort = () => {
      void worker.terminate();
      reject(makeError('cancelled', 'archive.7z'));
    };
    opts.signal?.addEventListener('abort', abort, { once: true });
    worker.on('message', (m: { type: string; line?: string; result?: SevenZipResult }) => {
      if (m.type === 'line') opts.onLine?.(m.line!);
      else if (m.type === 'done') {
        opts.signal?.removeEventListener('abort', abort);
        void worker.terminate();
        resolve(m.result!);
      }
    });
    worker.on('error', (err) => {
      opts.signal?.removeEventListener('abort', abort);
      reject(makeError('internal', 'archive.7z', { message: `7-Zip stopped unexpectedly: ${err.message}` }));
    });
  });
}

export interface SevenZipEntry {
  name: string;
  kind: 'file' | 'directory' | 'symlink' | 'other';
  size?: number;
  compressedSize?: number;
  modifiedMs?: number;
  encrypted: boolean;
  crc?: string;
}

/** Parse `7z l -slt` technical listing output. */
export function parseSltListing(lines: string[]): { type?: string; entries: SevenZipEntry[]; errors: string[] } {
  const entries: SevenZipEntry[] = [];
  const errors: string[] = [];
  let type: string | undefined;
  let i = lines.findIndex((l) => l.startsWith('----------'));
  // Archive properties come before the separator.
  for (const l of lines.slice(0, Math.max(0, i))) {
    const m = /^Type = (.+)$/.exec(l);
    if (m) type = m[1];
    if (/^(ERROR|Can not open|Open ERROR)/i.test(l)) errors.push(l);
  }
  if (i < 0) return { type, entries, errors };
  let cur: Record<string, string> = {};
  const flush = () => {
    if (!cur.Path) return;
    const attrs = cur.Attributes ?? '';
    const unix = /\s([dl-])[rwxsStT-]{9}/.exec(attrs)?.[1];
    const isDir = cur.Folder === '+' || attrs.startsWith('D') || unix === 'd';
    const isLink = unix === 'l' || !!cur['Symbolic Link'] || (!!cur.Link && cur.Link !== '-');
    const modified = cur.Modified ? Date.parse(cur.Modified.replace(' ', 'T').replace(/\.(\d{3})\d*/, '.$1')) : NaN;
    entries.push({
      name: cur.Path.replace(/\\/g, '/'),
      kind: isLink ? 'symlink' : isDir ? 'directory' : 'file',
      size: cur.Size !== undefined && cur.Size !== '' && !isDir ? Number(cur.Size) : undefined,
      compressedSize: cur['Packed Size'] ? Number(cur['Packed Size']) : undefined,
      modifiedMs: Number.isFinite(modified) ? modified : undefined,
      encrypted: cur.Encrypted === '+',
      crc: cur.CRC || undefined,
    });
    cur = {};
  };
  for (i = i + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (!l.trim()) {
      flush();
      continue;
    }
    const eq = l.indexOf(' = ');
    if (eq > 0) cur[l.slice(0, eq)] = l.slice(eq + 3);
    else if (/^(ERROR|Errors:)/i.test(l)) errors.push(l);
  }
  flush();
  return { type, entries, errors };
}

const IN = '/orbis/in';
const OUT = '/orbis/out';

/** 7-Zip output lines that mean "encrypted, and no (or the wrong) password". */
export const PASSWORD_LINE = /Wrong password|Can(?:no|')?t open encrypted archive|Can not open encrypted archive|Data Error in encrypted file/i;

/**
 * The error for an archive that needs a password. Never includes the password:
 * `supplied` only says whether one was given (and so was wrong).
 */
export function passwordError(operation: string, target: string | undefined, supplied: boolean, lines: string[] = []): Error {
  const dataError = lines.some((l) => /Data Error in encrypted file/i.test(l));
  return makeError('validation', operation, {
    target,
    message: supplied ? (dataError ? 'Wrong password, or the encrypted data is damaged.' : 'Wrong password.') : 'This archive is password-protected. Enter its password to continue.',
    needsPassword: true,
    wrongPassword: supplied,
    retryable: true,
  });
}

/**
 * Whether a 7z archive's header (the file list) is encrypted, read from the
 * file itself: the next header is an encoded header (0x17) whose coders
 * include 7zAES (method id 06 F1 07 01). 7-Zip cannot always say why such an
 * archive fails to open without the right password, so this decides it.
 */
export async function sevenZipHeaderEncrypted(archive: string): Promise<boolean> {
  let fh: fsp.FileHandle | undefined;
  try {
    fh = await fsp.open(archive, 'r');
    const start = Buffer.alloc(32);
    if ((await fh.read(start, 0, 32, 0)).bytesRead < 32 || !start.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) return false;
    const offset = start.readBigUInt64LE(12) + 32n;
    const size = start.readBigUInt64LE(20);
    if (size === 0n || size > 1024n * 1024n) return false;
    const head = Buffer.alloc(Number(size));
    await fh.read(head, 0, head.length, Number(offset));
    return head[0] === 0x17 && head.includes(Buffer.from([0x06, 0xf1, 0x07, 0x01]));
  } catch {
    return false;
  } finally {
    await fh?.close();
  }
}

/** 7-Zip stopped without a readable error (the WebAssembly build aborts this way on some undecryptable headers). */
function crashedSilently(r: SevenZipResult): boolean {
  return r.code >= 2 && ![...r.stdout, ...r.stderr].some((l) => /ERROR|Error|Can(?:no|')?t|Unexpected|Headers/i.test(l));
}

async function passwordTrouble(archive: string, r: SevenZipResult): Promise<boolean> {
  if ([...r.stdout, ...r.stderr].some((l) => PASSWORD_LINE.test(l))) return true;
  return crashedSilently(r) && (await sevenZipHeaderEncrypted(archive));
}

export async function list7z(archive: string, opts: { signal?: AbortSignal; password?: string } = {}): Promise<{ type?: string; entries: SevenZipEntry[]; errors: string[] }> {
  const r = await run7z({ args: ['l', '-slt', '-sccUTF-8', `${IN}/${path.basename(archive)}`], mounts: [{ real: path.dirname(archive), virt: IN }], password: opts.password }, { signal: opts.signal });
  const parsed = parseSltListing(r.stdout);
  if (r.code !== 0 && !parsed.entries.length) {
    const lines = [...r.stderr, ...parsed.errors];
    if (await passwordTrouble(archive, r)) throw passwordError('archive.list', archive, opts.password !== undefined, lines);
    const msg = lines.find((l) => l.trim()) ?? '7-Zip could not open the archive.';
    throw makeError('validation', 'archive.list', { target: archive, message: `The archive appears to be damaged: ${msg.replace(/^ERROR:\s*/, '')}` });
  }
  return parsed;
}

/**
 * Test archive integrity (checksums of every entry, or only `names`).
 * `passwordProblem` is set when entries could not be decrypted.
 */
export async function test7z(archive: string, opts: { signal?: AbortSignal; password?: string; names?: string[] } = {}): Promise<{ ok: boolean; errors: string[]; passwordProblem: boolean }> {
  const files = opts.names?.length ? [{ virt: '/orbis/list.txt', text: opts.names.join('\n') }] : [];
  const args = ['t', '-sccUTF-8', `${IN}/${path.basename(archive)}`];
  if (files.length) args.push('-spd', '-i@/orbis/list.txt');
  const r = await run7z({ args, mounts: [{ real: path.dirname(archive), virt: IN }], files, password: opts.password }, { signal: opts.signal });
  const all = [...r.stdout, ...r.stderr];
  const errors = all.filter((l) => /ERROR|CRC Failed|Data Error|Unexpected end|Headers Error|Wrong password|encrypted archive/i.test(l));
  return { ok: r.code === 0 && !errors.length, errors, passwordProblem: await passwordTrouble(archive, r) };
}

/**
 * Extract into `outDir` (which must be a fresh, empty directory the caller
 * owns). Optional `names` restricts extraction to those entries; wildcard
 * matching is disabled so names are taken literally.
 */
export async function extract7z(archive: string, outDir: string, opts: { names?: string[]; signal?: AbortSignal; password?: string } = {}): Promise<{ code: number; errors: string[]; passwordProblem: boolean }> {
  const files = opts.names?.length ? [{ virt: '/orbis/list.txt', text: opts.names.join('\n') }] : [];
  const args = ['x', '-y', '-sccUTF-8', '-scsUTF-8', `-o${OUT}`, `${IN}/${path.basename(archive)}`];
  if (files.length) args.push('-spd', '-i@/orbis/list.txt');
  const r = await run7z({ args, mounts: [{ real: path.dirname(archive), virt: IN }, { real: outDir, virt: OUT }], files, password: opts.password }, { signal: opts.signal });
  const all = [...r.stdout, ...r.stderr];
  const errors = all.filter((l) => /ERROR|CRC Failed|Data Error|Unexpected end|Wrong password|encrypted archive|Cannot/i.test(l));
  return { code: r.code, errors, passwordProblem: await passwordTrouble(archive, r) };
}

export interface Create7zOptions {
  signal?: AbortSignal;
  /** Container/compression type passed as 7-Zip's -t flag. */
  type?: '7z' | 'zip' | 'bzip2' | 'xz';
  /** Encrypt the contents with this password (AES-256). */
  password?: string;
  /** 7z only: also encrypt the file names, so the listing needs the password too. */
  encryptNames?: boolean;
}

/** Create a 7z (or AES-256 ZIP) archive at `outFile` from paths relative to `baseDir` (regular files and empty folders only). */
export async function create7z(outFile: string, baseDir: string, relPaths: string[], level: number, opts: Create7zOptions = {}): Promise<void> {
  const type = opts.type ?? '7z';
  const files = [{ virt: '/orbis/list.txt', text: relPaths.join('\n') }];
  const args = ['a', `-t${type}`, `-mx=${Math.max(0, Math.min(9, Math.round(level)))}`];
  if (opts.password !== undefined) {
    if (type === 'zip') args.push('-mem=AES256');
    else if (opts.encryptNames) args.push('-mhe=on');
  }
  args.push('-spd', '-sccUTF-8', '-scsUTF-8', `${OUT}/${path.basename(outFile)}`, '@/orbis/list.txt');
  const r = await run7z({ args, mounts: [{ real: baseDir, virt: IN }, { real: path.dirname(outFile), virt: OUT }], cwd: IN, files, password: opts.password }, { signal: opts.signal });
  if (r.code !== 0) throw makeError('io', 'archive.compress', { message: [...r.stderr, ...r.stdout].find((l) => /ERROR|WARNING/i.test(l)) ?? '7-Zip could not create the archive.' });
}
