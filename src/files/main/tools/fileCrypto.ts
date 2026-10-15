import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import { ENCRYPT_PASSWORD_MIN, ORBISENC_EXT } from '../../shared/crypto';
import { ARCHIVE_PASSWORD_MAX } from '../../shared/ipc';
import type { OperationRecord, OperationRequest } from '../../shared/operations';
import type { ExternalRunner, PlatformOps, RunContext, RunnerHelpers } from '../ops/OperationManager';
import { uniqueName, validateName } from '../fs/paths';
import { exists } from '../fs/FileSystemService';

/**
 * File encryption: `<name>.orbisenc`, a versioned container.
 *
 * Header (60 bytes, plain, and part of every chunk's associated data):
 *
 *   offset size
 *   0      8    magic "ORBISENC"
 *   8      1    format version (1)
 *   9      1    key derivation: 1 = scrypt
 *   10     1    scrypt log2(N) (15–20; files are written with 17)
 *   11     1    scrypt r (8)
 *   12     1    scrypt p (1)
 *   13     1    log2(chunk size) (12–24; files are written with 20 = 1 MiB)
 *   14     2    reserved, 0
 *   16     16   salt (random)
 *   32     8    nonce prefix (random)
 *   40     4    metadata length L (big-endian; a multiple of 256)
 *   44     16   key check: HMAC-SHA256(check key, "orbisenc v1 key check"), first 16 bytes
 *
 * scrypt(password as UTF-8 NFC, salt) gives 64 bytes: the AES-256 key, then
 * the key-check key. Then follow AES-256-GCM sealed blocks, each ciphertext
 * plus a 16-byte tag, with nonce = prefix ‖ counter (u32 BE) and associated
 * data = header ‖ counter (u32 BE) ‖ kind (u8):
 *
 *   counter 0, kind 0: metadata, L bytes: JSON {v, name, size, mtimeMs, atimeMs, mode}, zero-padded
 *   counter 1…n, kind 1: data chunks of exactly the chunk size
 *   counter n+1, kind 2: the final data chunk, 0 to chunk-size bytes (always present)
 *
 * Reordering or replacing chunks changes the counter; truncating or extending
 * the file changes which chunk is read as final (kind 2); a modified header is
 * part of every chunk's associated data. Each is detected as a failed
 * authentication tag (or a key-check mismatch when the salt or key-derivation
 * parameters were changed, which looks like a wrong password).
 */

export const MAGIC = Buffer.from('ORBISENC', 'latin1');
export const FORMAT_VERSION = 1;
export const HEADER_LEN = 60;
const TAG_LEN = 16;
const KDF_SCRYPT = 1;
export const DEFAULT_LOG2N = 17;
const DEFAULT_CHUNK_LOG2 = 20;
const META_BLOCK = 256;
const CHECK_LABEL = Buffer.from('orbisenc v1 key check', 'latin1');

export interface EncryptOptions {
  /** scrypt cost (log2 N), at least 15. */
  log2N?: number;
  /** Chunk size as a power of two (12–24); tests use small chunks. */
  chunkLog2?: number;
  signal?: AbortSignal;
  gate?: () => Promise<void>;
  onBytes?: (n: number) => void;
}

export interface OrbisEncMeta {
  v: 1;
  name: string;
  size: number;
  mtimeMs: number;
  atimeMs: number;
  mode: number;
}

const OP_ENC = 'crypto.encrypt';
const OP_DEC = 'crypto.decrypt';

/** Validate a password from operation parameters. Errors never contain the value. */
export function readCryptoPassword(value: unknown, operation: string, min = 1): string {
  if (typeof value !== 'string' || value.length < min || value.length > ARCHIVE_PASSWORD_MAX || value.includes('\0')) {
    throw makeError('validation', operation, {
      message: min > 1 ? `The password must be ${min} to ${ARCHIVE_PASSWORD_MAX} characters and cannot contain a null character.` : 'Enter the password.',
      needsPassword: typeof value !== 'string' || !value,
    });
  }
  return value;
}

function scryptAsync(password: string, salt: Buffer, log2N: number, r: number, p: number): Promise<Buffer> {
  const N = 2 ** log2N;
  return new Promise((resolve, reject) =>
    crypto.scrypt(Buffer.from(password.normalize('NFC'), 'utf8'), salt, 64, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

function keyCheck(checkKey: Buffer): Buffer {
  return crypto.createHmac('sha256', checkKey).update(CHECK_LABEL).digest().subarray(0, 16);
}

function nonce(prefix: Buffer, counter: number): Buffer {
  const n = Buffer.alloc(12);
  prefix.copy(n, 0, 0, 8);
  n.writeUInt32BE(counter, 8);
  return n;
}

function aad(header: Buffer, counter: number, kind: 0 | 1 | 2): Buffer {
  const tail = Buffer.alloc(5);
  tail.writeUInt32BE(counter, 0);
  tail[4] = kind;
  return Buffer.concat([header, tail]);
}

function seal(key: Buffer, header: Buffer, prefix: Buffer, counter: number, kind: 0 | 1 | 2, plain: Buffer): Buffer {
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce(prefix, counter), { authTagLength: TAG_LEN });
  c.setAAD(aad(header, counter, kind));
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}

/** Decrypt one sealed block; throws the "damaged" error when its tag does not verify. */
function open(key: Buffer, header: Buffer, prefix: Buffer, counter: number, kind: 0 | 1 | 2, sealed: Buffer, target?: string): Buffer {
  if (sealed.length < TAG_LEN) throw damaged(target);
  const d = crypto.createDecipheriv('aes-256-gcm', key, nonce(prefix, counter), { authTagLength: TAG_LEN });
  d.setAAD(aad(header, counter, kind));
  d.setAuthTag(sealed.subarray(sealed.length - TAG_LEN));
  try {
    return Buffer.concat([d.update(sealed.subarray(0, sealed.length - TAG_LEN)), d.final()]);
  } catch {
    throw damaged(target);
  }
}

export function damaged(target?: string): OrbisError {
  return makeError('validation', OP_DEC, { target, message: 'This file is damaged or was changed after it was encrypted (its authentication check failed). Nothing was decrypted from it.' });
}

function wrongPassword(target?: string): OrbisError {
  return makeError('validation', OP_DEC, { target, message: 'Wrong password. (If you are sure it is right, the start of the file is damaged.)', wrongPassword: true });
}

export interface ParsedHeader {
  header: Buffer;
  log2N: number;
  r: number;
  p: number;
  chunkSize: number;
  salt: Buffer;
  prefix: Buffer;
  metaLen: number;
  check: Buffer;
}

/** Parse and bound-check a container header (before any expensive key derivation). */
export function parseHeader(buf: Buffer, target?: string): ParsedHeader {
  if (buf.length < HEADER_LEN || !buf.subarray(0, 8).equals(MAGIC)) throw makeError('validation', OP_DEC, { target, message: 'This is not an Orbis Files encrypted file (.orbisenc).' });
  const header = Buffer.from(buf.subarray(0, HEADER_LEN));
  const version = header[8]!;
  if (version !== FORMAT_VERSION) throw makeError('unsupported', OP_DEC, { target, message: `This file uses encryption format version ${version}, which this version of Orbis Files cannot read.` });
  const kdf = header[9]!;
  const log2N = header[10]!;
  const r = header[11]!;
  const p = header[12]!;
  const chunkLog2 = header[13]!;
  const metaLen = header.readUInt32BE(40);
  // Limits keep a crafted header from asking for huge memory or work.
  if (kdf !== KDF_SCRYPT || log2N < 15 || log2N > 20 || r < 1 || r > 16 || p < 1 || p > 4 || 128 * 2 ** log2N * r > 1024 ** 3 || chunkLog2 < 12 || chunkLog2 > 24 || header.readUInt16BE(14) !== 0 || metaLen < META_BLOCK || metaLen > 64 * 1024 || metaLen % META_BLOCK !== 0) {
    throw damaged(target);
  }
  return { header, log2N, r, p, chunkSize: 2 ** chunkLog2, salt: header.subarray(16, 32), prefix: header.subarray(32, 40), metaLen, check: header.subarray(44, 60) };
}

/** Derive the key for a parsed header and check the password against the key check. */
export async function deriveForHeader(h: ParsedHeader, password: string, target?: string): Promise<Buffer> {
  const out = await scryptAsync(password, h.salt, h.log2N, h.r, h.p);
  const key = out.subarray(0, 32);
  if (!crypto.timingSafeEqual(keyCheck(out.subarray(32)), h.check)) throw wrongPassword(target);
  return key;
}

/** Check a password against a container's key check (one key derivation, nothing decrypted). */
export async function checkPassword(src: string, password: string): Promise<{ ok: true }> {
  const fh = await fsp.open(src, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)).catch((err) => {
    throw new OrbisError(toOrbisError(err, OP_DEC, src, 'no'));
  });
  try {
    const head = Buffer.alloc(HEADER_LEN);
    const { bytesRead } = await fh.read(head, 0, HEADER_LEN, 0);
    if (bytesRead < 8 || !head.subarray(0, 8).equals(MAGIC)) throw makeError('validation', OP_DEC, { target: src, message: 'This is not an Orbis Files encrypted file (.orbisenc).' });
    if (bytesRead < HEADER_LEN) throw damaged(src);
    await deriveForHeader(parseHeader(head, src), password, src);
    return { ok: true };
  } finally {
    await fh.close().catch(() => undefined);
  }
}

function sha256(): crypto.Hash {
  return crypto.createHash('sha256');
}

async function gateAndCheck(opts: { signal?: AbortSignal; gate?: () => Promise<void> }): Promise<void> {
  if (opts.signal?.aborted) throw makeError('cancelled', OP_ENC);
  await opts.gate?.();
}

/**
 * Encrypt `src` into the new file `out` (created exclusively). Returns the
 * plaintext's SHA-256 (to verify the result) and the metadata stored.
 */
export async function encryptFile(src: string, out: string, password: string, opts: EncryptOptions = {}): Promise<{ sha256: string; meta: OrbisEncMeta }> {
  const log2N = opts.log2N ?? DEFAULT_LOG2N;
  if (log2N < 15 || log2N > 20) throw makeError('validation', OP_ENC, { message: 'Unsupported key-derivation cost.' });
  const chunkLog2 = opts.chunkLog2 ?? DEFAULT_CHUNK_LOG2;
  const chunkSize = 2 ** chunkLog2;
  const input = await fsp.open(src, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  let output: fsp.FileHandle | undefined;
  try {
    const st = await input.stat();
    if (!st.isFile()) throw makeError('unsupported', OP_ENC, { target: src, message: 'Only regular files can be encrypted.' });
    const meta: OrbisEncMeta = { v: 1, name: path.basename(src), size: st.size, mtimeMs: st.mtimeMs, atimeMs: st.atimeMs, mode: st.mode & 0o7777 };
    const metaJson = Buffer.from(JSON.stringify(meta), 'utf8');
    const metaLen = Math.max(META_BLOCK, Math.ceil(metaJson.length / META_BLOCK) * META_BLOCK);
    if (metaLen > 64 * 1024) throw makeError('validation', OP_ENC, { target: src, message: 'The file name is too long to store.' });
    const metaPlain = Buffer.alloc(metaLen);
    metaJson.copy(metaPlain);

    const salt = crypto.randomBytes(16);
    const prefix = crypto.randomBytes(8);
    const derived = await scryptAsync(password, salt, log2N, 8, 1);
    const key = derived.subarray(0, 32);
    const header = Buffer.alloc(HEADER_LEN);
    MAGIC.copy(header, 0);
    header[8] = FORMAT_VERSION;
    header[9] = KDF_SCRYPT;
    header[10] = log2N;
    header[11] = 8;
    header[12] = 1;
    header[13] = chunkLog2;
    salt.copy(header, 16);
    prefix.copy(header, 32);
    header.writeUInt32BE(metaLen, 40);
    keyCheck(derived.subarray(32)).copy(header, 44);

    output = await fsp.open(out, 'wx', 0o600);
    await output.write(header);
    await output.write(seal(key, header, prefix, 0, 0, metaPlain));

    const hash = sha256();
    let counter = 1;
    let total = 0;
    let pending: Buffer | undefined; // a full chunk waiting to learn whether more data follows
    const buf = Buffer.alloc(chunkSize);
    for (;;) {
      await gateAndCheck(opts);
      // Fill one chunk (a read can return fewer bytes than asked).
      let filled = 0;
      while (filled < chunkSize) {
        const { bytesRead } = await input.read(buf, filled, chunkSize - filled, null);
        if (!bytesRead) break;
        filled += bytesRead;
      }
      const chunk = Buffer.from(buf.subarray(0, filled));
      if (pending) {
        if (!filled) {
          await output.write(seal(key, header, prefix, counter++, 2, pending));
          pending = undefined;
          break;
        }
        await output.write(seal(key, header, prefix, counter++, 1, pending));
      }
      total += filled;
      hash.update(chunk);
      opts.onBytes?.(filled);
      if (filled === chunkSize) {
        pending = chunk;
        continue;
      }
      await output.write(seal(key, header, prefix, counter++, 2, chunk));
      break;
    }
    if (counter > 0xffffffff) throw makeError('unsupported', OP_ENC, { target: src, message: 'The file is too large.' });
    const after = await input.stat();
    if (total !== st.size || after.size !== st.size || after.mtimeMs !== st.mtimeMs) {
      throw makeError('io', OP_ENC, { target: src, retryable: true, message: 'The file changed while it was being encrypted. Nothing was saved; try again when it is no longer being written to.' });
    }
    await output.sync();
    return { sha256: hash.digest('hex'), meta };
  } finally {
    await output?.close().catch(() => undefined);
    await input.close().catch(() => undefined);
  }
}

export interface DecryptResult {
  meta: OrbisEncMeta;
  sha256: string;
  bytes: number;
}

/**
 * Decrypt the container `src`. Every chunk's tag is verified before its
 * plaintext is written to `out` (created exclusively; omit it to only verify).
 * The caller removes `out` if this throws.
 */
export async function decryptFile(src: string, out: string | undefined, password: string, opts: EncryptOptions = {}): Promise<DecryptResult> {
  const input = await fsp.open(src, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  let output: fsp.FileHandle | undefined;
  try {
    const st = await input.stat();
    if (!st.isFile()) throw makeError('unsupported', OP_DEC, { target: src, message: 'Only regular files can be decrypted.' });
    const size = st.size;
    const readExact = async (pos: number, len: number): Promise<Buffer> => {
      const b = Buffer.alloc(len);
      let got = 0;
      while (got < len) {
        const { bytesRead } = await input.read(b, got, len - got, pos + got);
        if (!bytesRead) break;
        got += bytesRead;
      }
      if (got !== len) throw damaged(src);
      return b;
    };
    if (size < HEADER_LEN) {
      const head = await readExact(0, Math.min(size, 8)).catch(() => Buffer.alloc(0));
      if (!head.equals(MAGIC.subarray(0, head.length)) || head.length < 8) throw makeError('validation', OP_DEC, { target: src, message: 'This is not an Orbis Files encrypted file (.orbisenc).' });
      throw damaged(src);
    }
    const h = parseHeader(await readExact(0, HEADER_LEN), src);
    const key = await deriveForHeader(h, password, src);
    let pos = HEADER_LEN;
    const metaSealed = await readExact(pos, h.metaLen + TAG_LEN);
    pos += metaSealed.length;
    const metaPlain = open(key, h.header, h.prefix, 0, 0, metaSealed, src);
    const meta = parseMeta(metaPlain, src);
    if (pos + TAG_LEN > size) throw damaged(src);

    if (out !== undefined) output = await fsp.open(out, 'wx', 0o600);
    const hash = sha256();
    const full = h.chunkSize + TAG_LEN;
    let counter = 1;
    let bytes = 0;
    while (pos < size) {
      await gateAndCheck(opts);
      const len = Math.min(full, size - pos);
      const isFinal = pos + len === size;
      const sealed = await readExact(pos, len);
      pos += len;
      const plain = open(key, h.header, h.prefix, counter, isFinal ? 2 : 1, sealed, src);
      if (!isFinal && plain.length !== h.chunkSize) throw damaged(src);
      counter++;
      bytes += plain.length;
      hash.update(plain);
      if (output) await output.write(plain);
      opts.onBytes?.(len);
    }
    if (bytes !== meta.size) throw damaged(src);
    if (output) await output.sync();
    return { meta, sha256: hash.digest('hex'), bytes };
  } finally {
    await output?.close().catch(() => undefined);
    await input.close().catch(() => undefined);
  }
}

function parseMeta(plain: Buffer, src: string): OrbisEncMeta {
  let end = plain.length;
  while (end > 0 && plain[end - 1] === 0) end--;
  let m: unknown;
  try {
    m = JSON.parse(plain.subarray(0, end).toString('utf8'));
  } catch {
    throw damaged(src);
  }
  const o = m as Partial<OrbisEncMeta>;
  if (!o || o.v !== 1 || typeof o.name !== 'string' || !Number.isSafeInteger(o.size) || o.size! < 0 || typeof o.mtimeMs !== 'number' || typeof o.atimeMs !== 'number' || !Number.isInteger(o.mode)) throw damaged(src);
  return o as OrbisEncMeta;
}

/* ------------------------------------------------------------------ operations */

interface CryptoParams {
  password?: unknown;
  /** Encrypt: move each original to the Trash after its encrypted copy was written and verified. */
  deleteOriginals?: unknown;
}

/** The files an encrypt/decrypt request acts on: selected files, plus files inside selected folders (links never followed). */
async function expand(sources: string[], want: (name: string) => boolean, rec: OperationRecord, ctx: RunContext, operation: string): Promise<Array<{ path: string; size: number }>> {
  const out: Array<{ path: string; size: number }> = [];
  for (const src of sources) {
    const st = await fsp.lstat(src).catch((err) => {
      rec.results.push({ source: src, status: 'failed', error: toOrbisError(err, operation, src, 'no') });
      return undefined;
    });
    if (!st) continue;
    if (st.isSymbolicLink()) {
      rec.results.push({ source: src, status: 'skipped', error: { category: 'unsupported', operation, message: 'Links are not followed; select the item they point to.', target: src, dataChanged: 'no', retryable: false } });
      continue;
    }
    if (st.isFile()) {
      out.push({ path: src, size: st.size });
      continue;
    }
    if (!st.isDirectory()) continue;
    const stack = [src];
    while (stack.length) {
      await ctx.gate();
      const dir = stack.pop()!;
      for (const d of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (d.name.startsWith('.orbis-part-')) continue;
        const p = path.join(dir, d.name);
        if (d.isDirectory()) stack.push(p);
        else if (d.isFile() && want(d.name)) out.push({ path: p, size: (await fsp.lstat(p).catch(() => undefined))?.size ?? 0 });
      }
    }
  }
  return out;
}

/** Commit a finished temporary file under `name` in `dir`, never replacing anything (keep both). Returns the final path. */
async function commitKeepBoth(tmp: string, dir: string, name: string): Promise<string> {
  let target = path.join(dir, name);
  if (await exists(target)) target = path.join(dir, await uniqueName(dir, name, exists));
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.link(tmp, target);
      await fsp.unlink(tmp);
      return target;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST' && attempt < 50) {
        target = path.join(dir, await uniqueName(dir, name, exists));
        continue;
      }
      if (code === 'EEXIST') throw err;
      // No hard links here (FAT, some network shares): a checked rename.
      if (await exists(target)) target = path.join(dir, await uniqueName(dir, name, exists));
      await fsp.rename(tmp, target);
      return target;
    }
  }
}

function tempIn(dir: string): string {
  return path.join(dir, `.orbis-part-${crypto.randomUUID()}`);
}

export function validateCryptoRequest(req: OperationRequest): void {
  const params = (req.params ?? {}) as CryptoParams;
  const op = req.type === 'encrypt' ? OP_ENC : OP_DEC;
  readCryptoPassword(params.password, op, req.type === 'encrypt' ? ENCRYPT_PASSWORD_MIN : 1);
  if (params.deleteOriginals !== undefined && typeof params.deleteOriginals !== 'boolean') throw makeError('validation', op, { message: 'Invalid option.' });
  if (!req.sources.length) throw makeError('validation', op, { message: 'Select files first.' });
}

export function makeEncryptRunner(deps: { platform: PlatformOps; markRunning: (rec: OperationRecord) => void; log2N?: number; chunkLog2?: number; onChanged?: (p: string) => void }): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const params = (req.params ?? {}) as CryptoParams;
    const password = readCryptoPassword(params.password, OP_ENC, ENCRYPT_PASSWORD_MIN);
    const deleteOriginals = params.deleteOriginals === true;
    if (deleteOriginals && !deps.platform.trashSupported) throw makeError('unsupported', OP_ENC, { message: 'The Trash is not available, so originals cannot be moved there. Encrypt without that option.' });
    rec.itemResults = true;
    // Files inside folders that are already encrypted are left alone.
    const files = await expand(rec.sources, (n) => !n.toLowerCase().endsWith(ORBISENC_EXT), rec, ctx, OP_ENC);
    rec.progress = { totalItems: files.length, totalBytes: files.reduce((a, f) => a + f.size, 0), completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    for (const f of files) {
      await ctx.gate();
      const dir = path.dirname(f.path);
      const tmp = tempIn(dir);
      helpers.temp(tmp);
      try {
        const before = await fsp.lstat(f.path);
        const { sha256: plainHash } = await encryptFile(f.path, tmp, password, { log2N: deps.log2N, chunkLog2: deps.chunkLog2, signal: ctx.signal, gate: () => ctx.gate(), onBytes: (n) => helpers.tick(n, 0, path.basename(f.path)) });
        const target = await commitKeepBoth(tmp, dir, `${path.basename(f.path)}${ORBISENC_EXT}`);
        helpers.committed(tmp);
        deps.onChanged?.(target);
        let note: string | undefined;
        if (deleteOriginals) {
          // Only after the encrypted copy decrypts to exactly the same bytes, and the original is unchanged.
          const check = await decryptFile(target, undefined, password, { signal: ctx.signal, gate: () => ctx.gate() });
          const now = await fsp.lstat(f.path);
          if (check.sha256 !== plainHash || now.size !== before.size || now.mtimeMs !== before.mtimeMs) {
            note = 'The original was kept: it changed, or the encrypted copy could not be verified.';
          } else {
            await deps.platform.trash(f.path);
            deps.onChanged?.(f.path);
          }
        }
        rec.results.push({ source: f.path, destination: target, status: 'done', ...(note ? { error: { category: 'io', operation: OP_ENC, message: note, target: f.path, dataChanged: 'yes', retryable: false } } : {}) });
        if (note) rec.notes = [...(rec.notes ?? []), `${path.basename(f.path)}: ${note}`];
        helpers.tick(0, 1);
      } catch (err) {
        await fsp.rm(tmp, { force: true }).catch(() => undefined);
        helpers.committed(tmp);
        const shape = toOrbisError(err, OP_ENC, f.path, 'no');
        if (shape.category === 'cancelled' || ctx.signal.aborted) throw err;
        rec.results.push({ source: f.path, status: 'failed', error: shape });
      }
    }
    if (!files.length && !rec.results.length) throw makeError('validation', OP_ENC, { message: 'There are no files to encrypt in the selection.' });
    rec.undo = { kind: 'none', reason: 'Encrypted copies are not removed automatically. Delete them yourself if you do not need them.' };
  };
}

export function makeDecryptRunner(deps: { markRunning: (rec: OperationRecord) => void; onChanged?: (p: string) => void }): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const params = (req.params ?? {}) as CryptoParams;
    const password = readCryptoPassword(params.password, OP_DEC, 1);
    rec.itemResults = true;
    const files = await expand(rec.sources, (n) => n.toLowerCase().endsWith(ORBISENC_EXT), rec, ctx, OP_DEC);
    rec.progress = { totalItems: files.length, totalBytes: files.reduce((a, f) => a + f.size, 0), completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    let wrong = 0;
    for (const f of files) {
      await ctx.gate();
      const dir = path.dirname(f.path);
      const tmp = tempIn(dir);
      helpers.temp(tmp);
      try {
        const r = await decryptFile(f.path, tmp, password, { signal: ctx.signal, gate: () => ctx.gate(), onBytes: (n) => helpers.tick(n, 0, path.basename(f.path)) });
        await fsp.chmod(tmp, r.meta.mode & 0o777).catch(() => undefined);
        await fsp.utimes(tmp, new Date(r.meta.atimeMs), new Date(r.meta.mtimeMs)).catch(() => undefined);
        const stored = r.meta.name;
        const fallback = path.basename(f.path).replace(/\.orbisenc$/i, '') || 'decrypted';
        const name = validateName(stored).valid && !stored.startsWith('.orbis-part-') ? stored : validateName(fallback).valid ? fallback : 'decrypted';
        const target = await commitKeepBoth(tmp, dir, name);
        helpers.committed(tmp);
        deps.onChanged?.(target);
        rec.results.push({ source: f.path, destination: target, status: 'done' });
        helpers.tick(0, 1);
      } catch (err) {
        await fsp.rm(tmp, { force: true }).catch(() => undefined);
        helpers.committed(tmp);
        const shape = toOrbisError(err, OP_DEC, f.path, 'no');
        if (shape.category === 'cancelled' || ctx.signal.aborted) throw err;
        if (shape.wrongPassword) wrong++;
        rec.results.push({ source: f.path, status: 'failed', error: shape });
      }
    }
    if (!files.length && !rec.results.length) throw makeError('validation', OP_DEC, { message: 'There are no .orbisenc files in the selection.' });
    // Every file refused the password: report it as a wrong password for the whole operation.
    if (wrong && wrong === files.length) rec.error = wrongPassword().shape;
    rec.undo = { kind: 'none', reason: 'Decrypted copies are not removed automatically. Delete them yourself if you do not need them.' };
  };
}

export type { RunnerHelpers };
