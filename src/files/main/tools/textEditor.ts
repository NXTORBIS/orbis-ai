import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import type { TextEncodingName } from '../../shared/docTools';
import {
  copyName, detectEol, EDITOR_MAX_BYTES, EDITOR_MAX_WRITE_BYTES, fromLf, toLf,
  type EditorDoc, type EditorOpenResult, type EditorSaveResult, type EditorStamp, type EditorWrite,
} from '../../shared/editor';
import { validateName } from '../fs/paths';
import { bomBytes, bomLength, decodeText, detectText, encodeText } from './textCodec';
import { diffStrings, type TextDiff } from './analysis';
import { PART_PREFIX, replaceFileAtomic, sha256Of, writeNewFile, type ReplaceHooks } from './docFiles';

/**
 * The built-in editor's file side. Opening reads the whole file (up to 5 MB),
 * detects its encoding, byte-order mark and line endings with the document
 * tools' codec, and returns the text with LF line endings plus a stamp (size,
 * modification time, SHA-256). Saving compares the file with that stamp first
 * (a different SHA-256 is a conflict: nothing is written), takes a snapshot of
 * the version about to be replaced, encodes the text back in the file's
 * encoding and line endings, and replaces the file atomically (temporary
 * sibling → fsync → read back → original re-checked → rename → verified).
 * New files are committed with link(), which never replaces anything.
 */

export interface EditorDeps {
  /** Keep the current version before it is replaced (SnapshotStore.create). */
  snapshot: (p: string) => Promise<{ id: string }>;
  /** Called after a file was written (metadata cache, index). */
  onChanged?: (p: string) => void;
  /** Test seam for the atomic replace. */
  hooks?: ReplaceHooks;
}

export async function stampOf(p: string): Promise<EditorStamp | null> {
  const st = await fsp.stat(p).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
    throw new OrbisError(toOrbisError(err, 'editor.stat', p, 'no'));
  });
  if (!st) return null;
  if (!st.isFile()) throw makeError('unsupported', 'editor.stat', { target: p, message: 'This is no longer a file.' });
  const bytes = await fsp.readFile(p);
  return { size: bytes.length, mtimeMs: st.mtimeMs, sha256: sha256Of(bytes) };
}

/** Whether the file can be written in place, and if not, why (shown as the read-only banner). */
export async function writeAccess(p: string, mode: number): Promise<{ readOnly: boolean; readOnlyReason?: string }> {
  if (process.platform !== 'win32' && (mode & 0o222) === 0) return { readOnly: true, readOnlyReason: 'The file is marked read-only (nobody has permission to write it).' };
  try {
    await fsp.access(p, fs.constants.W_OK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { readOnly: true, readOnlyReason: code === 'EROFS' ? 'The drive this file is on is read-only.' : 'You do not have permission to change this file.' };
  }
  try {
    await fsp.access(path.dirname(p), fs.constants.W_OK);
  } catch {
    return { readOnly: true, readOnlyReason: 'The folder is not writable, so the file cannot be saved safely: Orbis Files writes the new version beside it first and then swaps it in.' };
  }
  return { readOnly: false };
}

/** Read a file for editing. `encoding` re-reads it in a chosen encoding instead of the detected one ("Reopen with encoding"). */
export async function openForEditing(requested: string, opts: { maxBytes?: number; encoding?: TextEncodingName } = {}): Promise<EditorOpenResult> {
  const maxBytes = opts.maxBytes ?? EDITOR_MAX_BYTES;
  let real: string;
  try {
    real = await fsp.realpath(requested);
  } catch (err) {
    throw new OrbisError(toOrbisError(err, 'editor.open', requested, 'no'));
  }
  const st = await fsp.stat(real).catch((err) => {
    throw new OrbisError(toOrbisError(err, 'editor.open', requested, 'no'));
  });
  if (!st.isFile()) return { status: 'refused', reason: 'not-file', path: requested, message: st.isDirectory() ? 'This is a folder; only files can be edited.' : 'This is not a regular file (a device, socket or pipe), so it cannot be edited.' };
  if (st.size > maxBytes) {
    return { status: 'refused', reason: 'too-large', path: requested, size: st.size, message: `This file is ${(st.size / 1024 / 1024).toFixed(1)} MB. The built-in editor opens files up to ${Math.round(maxBytes / 1024 / 1024)} MB; open it with its default app instead.` };
  }
  const bytes = await fsp.readFile(real).catch((err) => {
    throw new OrbisError(toOrbisError(err, 'editor.open', requested, 'no'));
  });
  if (bytes.length > maxBytes) return { status: 'refused', reason: 'too-large', path: requested, size: bytes.length, message: `This file grew to ${(bytes.length / 1024 / 1024).toFixed(1)} MB while it was opened; the editor opens files up to ${Math.round(maxBytes / 1024 / 1024)} MB.` };
  const detected = detectText(bytes);
  // 8-bit text that is not UTF-8 is edited as Windows-1252: it reads every byte the same as Latin-1 would (bytes 0x80–0x9F
  // are what tell them apart, and the detector already picks Windows-1252 when they occur), and it can also hold € and “ ”.
  const d = opts.encoding ? { encoding: opts.encoding, source: 'detected' as const, binary: detected.binary && opts.encoding !== 'utf16le' && opts.encoding !== 'utf16be' } : { ...detected, encoding: detected.encoding === 'latin1' ? 'windows1252' as const : detected.encoding };
  if (d.binary) return { status: 'refused', reason: 'binary', path: requested, size: bytes.length, message: 'This file looks like binary data, not text. Editing it as text would damage it, so open it with its default app instead.' };
  const bom = bomLength(bytes, d.encoding);
  let raw: string;
  try {
    raw = decodeText(bytes.subarray(bom), d.encoding, 'editor.open');
  } catch (err) {
    return { status: 'refused', reason: 'not-text', path: requested, size: bytes.length, message: toOrbisError(err, 'editor.open').message };
  }
  if (raw.includes('\0') && d.encoding !== 'utf16le' && d.encoding !== 'utf16be') {
    return { status: 'refused', reason: 'binary', path: requested, size: bytes.length, message: 'This file contains NUL characters, so it is treated as binary data and not opened as text.' };
  }
  const { eol, mixed } = detectEol(raw);
  const access = await writeAccess(real, st.mode);
  const doc: EditorDoc = {
    path: real,
    requestedPath: requested,
    name: path.basename(real),
    text: toLf(raw),
    encoding: d.encoding,
    encodingSource: opts.encoding ? 'chosen' : bom > 0 ? 'bom' : d.source,
    bom: bom > 0,
    eol,
    mixedEol: mixed,
    stamp: { size: bytes.length, mtimeMs: st.mtimeMs, sha256: sha256Of(bytes) },
    ...access,
  };
  return { status: 'ok', doc };
}

/** The bytes for `w`: the text with its line endings, in its encoding, with a byte-order mark when asked (UTF-8/UTF-16 only). */
export function encodeForSave(w: EditorWrite, op = 'editor.save'): Buffer {
  const body = encodeText(fromLf(toLf(w.text), w.eol), w.encoding, op);
  const withBom = w.bom && (w.encoding === 'utf8' || w.encoding === 'utf16le' || w.encoding === 'utf16be');
  const data = withBom ? Buffer.concat([bomBytes(w.encoding), body]) : body;
  if (data.length > EDITOR_MAX_WRITE_BYTES) throw makeError('unsupported', op, { message: `The text is ${(data.length / 1024 / 1024).toFixed(0)} MB when saved; the editor writes files up to ${EDITOR_MAX_WRITE_BYTES / 1024 / 1024} MB.` });
  return data;
}

async function realOrSelf(p: string): Promise<string> {
  try {
    return await fsp.realpath(p);
  } catch {
    return p;
  }
}

async function snapshotFirst(p: string, deps: EditorDeps, op: string): Promise<string> {
  try {
    return (await deps.snapshot(p)).id;
  } catch (err) {
    throw makeError('unavailable', op, { target: p, message: `A safety snapshot of the current version could not be taken (${toOrbisError(err, 'snapshot').message}). Nothing was saved; use Save as… to keep your changes in another file.` });
  }
}

/** Write a new file at exactly `target` (temporary sibling → fsync → verify → link). Returns false when the name is taken. */
async function writeExclusive(target: string, data: Buffer, op: string): Promise<boolean> {
  const tmp = path.join(path.dirname(target), `${PART_PREFIX}${crypto.randomUUID()}`);
  try {
    const fh = await fsp.open(tmp, 'wx', 0o666);
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
    if (!(await fsp.readFile(tmp)).equals(data)) throw makeError('io', op, { target, message: 'The new file could not be verified after writing. Nothing was saved.' });
    try {
      await fsp.link(tmp, target);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') return false;
      if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EOPNOTSUPP' && code !== 'EXDEV') throw err;
      // No hard links here (FAT, some network shares): check, then rename.
      if (await fsp.lstat(target).then(() => true, () => false)) return false;
      await fsp.rename(tmp, target);
    }
    return true;
  } catch (err) {
    throw new OrbisError(toOrbisError(err, op, target, 'no'));
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
  }
}

async function savedResult(p: string, snapshotId?: string): Promise<EditorSaveResult> {
  const st = await fsp.stat(p);
  const stamp = await stampOf(p);
  if (!stamp) throw makeError('io', 'editor.save', { target: p, message: 'The file was saved but is no longer there.' });
  return { status: 'saved', path: p, stamp, snapshotId, ...(await writeAccess(p, st.mode)) };
}

/**
 * Save over the file the editor loaded. `expected` is the stamp it loaded (or
 * last saved); a file whose SHA-256 differs is a conflict and is left alone.
 * `expected: null` recreates a file that was deleted (refused if something is there again).
 */
export async function saveEdited(req: EditorWrite & { path: string; expected: EditorStamp | null }, deps: EditorDeps): Promise<EditorSaveResult> {
  const op = 'editor.save';
  const target = await realOrSelf(req.path);
  const data = encodeForSave(req, op);
  const current = await stampOf(target);
  if (req.expected === null) {
    if (current) return { status: 'conflict', current };
    const parent = await fsp.stat(path.dirname(target)).catch(() => null);
    if (!parent?.isDirectory()) throw makeError('not_found', op, { target, message: 'The folder this file was in no longer exists. Use Save as… to choose another place.' });
    if (!(await writeExclusive(target, data, op))) return { status: 'conflict', current: await stampOf(target) };
    deps.onChanged?.(target);
    return savedResult(target);
  }
  if (!current || current.sha256 !== req.expected.sha256 || current.size !== req.expected.size) return { status: 'conflict', current };
  const snapshotId = await snapshotFirst(target, deps, op);
  try {
    await replaceFileAtomic(target, data, req.expected.sha256, undefined, op, deps.hooks);
  } catch (err) {
    const shape = toOrbisError(err, op, target, 'no');
    // The file changed between the comparison above and the swap: report it as the conflict it is.
    if (shape.category === 'busy') return { status: 'conflict', current: await stampOf(target) };
    throw new OrbisError(shape);
  }
  deps.onChanged?.(target);
  return savedResult(target, snapshotId);
}

/** Save as: a new file in `dir`, never replacing one unless `replace` carries the stamp the user agreed to replace. */
export async function saveAsNew(req: EditorWrite & { dir: string; name: string; replace?: EditorStamp }, deps: EditorDeps): Promise<EditorSaveResult> {
  const op = 'editor.saveAs';
  const check = validateName(req.name);
  if (!check.valid) throw makeError('invalid_name', op, { message: check.reason ?? 'The name is not valid.' });
  const dirSt = await fsp.stat(req.dir).catch((err) => {
    throw new OrbisError(toOrbisError(err, op, req.dir, 'no'));
  });
  if (!dirSt.isDirectory()) throw makeError('not_a_directory', op, { target: req.dir });
  const target = path.join(req.dir, req.name);
  const data = encodeForSave(req, op);
  const there = await fsp.lstat(target).catch(() => null);
  if (there) {
    if (!there.isFile()) throw makeError('already_exists', op, { target, message: 'A folder or link already has this name. Choose another name.' });
    const current = await stampOf(target);
    if (!req.replace || !current || current.sha256 !== req.replace.sha256) return { status: 'exists', path: target, current };
    const snapshotId = await snapshotFirst(target, deps, op);
    try {
      await replaceFileAtomic(target, data, current.sha256, undefined, op, deps.hooks);
    } catch (err) {
      const shape = toOrbisError(err, op, target, 'no');
      if (shape.category === 'busy') return { status: 'exists', path: target, current: await stampOf(target) };
      throw new OrbisError(shape);
    }
    deps.onChanged?.(target);
    return savedResult(target, snapshotId);
  }
  if (!(await writeExclusive(target, data, op))) return { status: 'exists', path: target, current: await stampOf(target) };
  deps.onChanged?.(target);
  return savedResult(target);
}

/** Keep the editor's version beside the original as "name (copy).ext" (or "(copy) (2)"…), never replacing anything. */
export async function saveCopy(req: EditorWrite & { path: string }, deps: EditorDeps): Promise<EditorSaveResult> {
  const op = 'editor.saveCopy';
  const target = await realOrSelf(req.path);
  const data = encodeForSave(req, op);
  const noop = { temp: () => undefined, committed: () => undefined };
  const written = await writeNewFile(path.dirname(target), copyName(path.basename(target)), data, noop, op);
  deps.onChanged?.(written);
  return savedResult(written);
}

/** Line diff between the file on disk (decoded as it is now) and the editor's text. */
export async function diffWithDisk(p: string, text: string): Promise<TextDiff & { missing: boolean }> {
  const target = await realOrSelf(p);
  const bytes = await fsp.readFile(target).catch(() => null);
  if (!bytes) return { ...diffStrings('', toLf(text)), missing: true };
  if (bytes.length > EDITOR_MAX_BYTES * 2) throw makeError('unsupported', 'editor.diff', { message: 'The file on disk is too large to compare here.' });
  const d = detectText(bytes);
  if (d.binary) throw makeError('unsupported', 'editor.diff', { message: 'The file on disk is now binary data, so it cannot be compared as text.' });
  const disk = toLf(decodeText(bytes.subarray(bomLength(bytes, d.encoding)), d.encoding, 'editor.diff'));
  return { ...diffStrings(disk, toLf(text)), missing: false };
}
