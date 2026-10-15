import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import { BUNDLED_LANGS, LANG_CODE_RE, langName, type OcrLanguageInfo } from '../../shared/ocr';
import type { LanguageSource } from './engine';

/**
 * Language data for text recognition. English ships with the app
 * (`<bundledDir>/eng.traineddata.gz`, the "best int" LSTM model); other languages
 * are `.traineddata` files the user already has and adds in Settings → Text
 * recognition. They are checked (Tesseract's file layout, then a real engine
 * start) and copied into the profile (`<profile>/ocr-languages/<code>.traineddata`);
 * nothing is ever downloaded.
 */

/** Largest language file accepted (the biggest "best" models are about 100 MB). */
export const LANG_FILE_MAX = 200 * 1024 * 1024;

/**
 * Checks Tesseract's traineddata layout: an int32 entry count followed by that many int64
 * offsets, each -1 (absent) or inside the file and in ascending order. Gzip files are unpacked first.
 */
export function checkTraineddata(raw: Uint8Array): { ok: true; entries: number } | { ok: false; reason: string } {
  let b = raw;
  if (b[0] === 0x1f && b[1] === 0x8b) {
    try {
      b = zlib.gunzipSync(b);
    } catch {
      return { ok: false, reason: 'The compressed file is damaged.' };
    }
  }
  if (b.length < 16) return { ok: false, reason: 'The file is too small to be language data.' };
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const count = view.getInt32(0, true);
  if (count < 1 || count > 64) return { ok: false, reason: 'This is not a Tesseract .traineddata file.' };
  if (4 + count * 8 > b.length) return { ok: false, reason: 'The file is truncated.' };
  let last = 4 + count * 8;
  let present = 0;
  for (let i = 0; i < count; i++) {
    const off = Number(view.getBigInt64(4 + i * 8, true));
    if (off === -1) continue;
    if (off < last || off > b.length) return { ok: false, reason: 'The file is damaged (its table of contents does not match its size).' };
    last = off;
    present++;
  }
  if (!present) return { ok: false, reason: 'The file contains no models.' };
  return { ok: true, entries: present };
}

export class OcrLanguageStore extends EventEmitter implements LanguageSource {
  private cache = new Map<string, Uint8Array>();

  constructor(private readonly bundledDir: string, readonly userDir: string) {
    super();
  }

  private bundledFile(code: string): string | undefined {
    return (BUNDLED_LANGS as readonly string[]).includes(code) ? path.join(this.bundledDir, `${code}.traineddata.gz`) : undefined;
  }

  async list(): Promise<OcrLanguageInfo[]> {
    const out: OcrLanguageInfo[] = [];
    for (const code of BUNDLED_LANGS) {
      const st = await fsp.stat(this.bundledFile(code)!).catch(() => undefined);
      if (st) out.push({ code, name: langName(code), source: 'bundled', bytes: st.size });
    }
    for (const d of await fsp.readdir(this.userDir, { withFileTypes: true }).catch(() => [])) {
      const m = /^(.+)\.traineddata$/.exec(d.name);
      if (!d.isFile() || !m || !LANG_CODE_RE.test(m[1]!) || out.some((l) => l.code === m[1])) continue;
      const st = await fsp.stat(path.join(this.userDir, d.name)).catch(() => undefined);
      if (st) out.push({ code: m[1]!, name: langName(m[1]!), source: 'added', bytes: st.size });
    }
    return out;
  }

  async load(code: string): Promise<Uint8Array> {
    if (!LANG_CODE_RE.test(code)) throw makeError('validation', 'ocr.language', { message: `“${code}” is not a language code.` });
    const hit = this.cache.get(code);
    if (hit) return hit;
    const file = this.bundledFile(code) ?? path.join(this.userDir, `${code}.traineddata`);
    const bytes = await fsp.readFile(file).catch(() => {
      throw makeError('not_found', 'ocr.language', { message: `${langName(code)} (${code}) is not installed. Add its .traineddata file in Settings → Text recognition.` });
    });
    const data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Keep the bundled language in memory; added ones can be large, so they are read again when needed.
    if (this.bundledFile(code)) this.cache.set(code, data);
    return data;
  }

  /**
   * Copy a .traineddata file into the profile. The name gives the code ("deu.traineddata" → deu);
   * an installed code is never replaced (remove it first). `verify` starts the engine with it.
   */
  async add(src: string, verify?: (code: string, data: Uint8Array) => Promise<void>): Promise<OcrLanguageInfo> {
    const op = 'ocr.addLanguage';
    const m = /^(.+)\.traineddata$/i.exec(path.basename(src));
    if (!m) throw makeError('validation', op, { message: 'Choose a file named like “deu.traineddata” (the name is the language code).' });
    const code = m[1]!;
    if (!LANG_CODE_RE.test(code)) throw makeError('validation', op, { message: `“${code}” is not a language code (letters, digits and _ only).` });
    if (this.bundledFile(code)) throw makeError('already_exists', op, { message: `${langName(code)} is built in.` });
    const st = await fsp.stat(src).catch((err) => {
      throw new OrbisError(toOrbisError(err, op, src, 'no'));
    });
    if (!st.isFile()) throw makeError('validation', op, { message: 'Choose a file.' });
    if (st.size > LANG_FILE_MAX) throw makeError('unsupported', op, { message: `Language files over ${LANG_FILE_MAX / 1024 / 1024} MB are not accepted.` });
    const target = path.join(this.userDir, `${code}.traineddata`);
    if (await fsp.stat(target).then(() => true, () => false)) throw makeError('already_exists', op, { message: `${langName(code)} (${code}) is already added. Remove it first to replace it.` });
    const bytes = await fsp.readFile(src);
    const check = checkTraineddata(bytes);
    if (!check.ok) throw makeError('validation', op, { message: `“${path.basename(src)}”: ${check.reason}` });
    const data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (verify) {
      try {
        await verify(code, data);
      } catch (err) {
        throw makeError('validation', op, { message: `The recognition engine could not use “${path.basename(src)}”: ${toOrbisError(err, op).message}` });
      }
    }
    await fsp.mkdir(this.userDir, { recursive: true });
    const tmp = path.join(this.userDir, `.orbis-part-${crypto.randomUUID()}`);
    try {
      const fh = await fsp.open(tmp, 'wx', 0o600);
      try {
        await fh.writeFile(bytes);
        await fh.sync();
      } finally {
        await fh.close();
      }
      if (!(await fsp.readFile(tmp)).equals(bytes)) throw makeError('io', op, { message: 'The copy could not be verified.' });
      await fsp.link(tmp, target).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'EEXIST') throw makeError('already_exists', op, { message: `${langName(code)} (${code}) is already added.` });
        throw err;
      });
    } finally {
      await fsp.rm(tmp, { force: true });
    }
    this.cache.delete(code);
    this.emit('changed');
    return { code, name: langName(code), source: 'added', bytes: bytes.length };
  }

  async remove(code: string): Promise<void> {
    if (this.bundledFile(code)) throw makeError('unsupported', 'ocr.removeLanguage', { message: `${langName(code)} is built in and cannot be removed.` });
    if (!LANG_CODE_RE.test(code)) throw makeError('validation', 'ocr.removeLanguage', { message: 'Not a language code.' });
    await fsp.unlink(path.join(this.userDir, `${code}.traineddata`)).catch((err) => {
      throw new OrbisError(toOrbisError(err, 'ocr.removeLanguage', code, 'no'));
    });
    this.cache.delete(code);
    this.emit('changed');
  }
}
