import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import type { EntryKind } from '../../shared/model';
import type { TrashDirSummary, TrashItem } from '../../shared/trash';
import { isWithin } from './paths';

/**
 * Reads and manages the system Trash on Linux, following the freedesktop.org
 * Trash specification 1.0:
 *
 *  - the home trash is `$XDG_DATA_HOME/Trash` (default `~/.local/share/Trash`);
 *  - each drive (top directory) may have `$topdir/.Trash/$uid` — used only when
 *    `$topdir/.Trash` is a real directory (not a link) with the sticky bit set —
 *    and `$topdir/.Trash-$uid`;
 *  - every trash directory holds `files/<name>` (the item) and
 *    `info/<name>.trashinfo` (`[Trash Info]`, `Path=` percent-encoded, absolute
 *    or relative to the top directory, and `DeletionDate=YYYY-MM-DDThh:mm:ss`).
 *
 * Nothing here trusts the Trash's contents: .trashinfo files are size-limited
 * and parsed defensively, a recorded Path that leaves its drive (volume
 * trashes) or points into a trash directory is refused, links inside the Trash
 * are moved as links and never followed, and restoring never replaces an
 * existing file or folder.
 */

const INFO_EXT = '.trashinfo';
const MAX_INFO_BYTES = 64 * 1024;
/** Folder totals stop after this many entries per item (reported as incomplete). */
const MAX_SIZE_ENTRIES = 20000;

export interface TrashDir extends TrashDirSummary {
  /** Directory that relative `Path=` values are resolved against. */
  base: string;
}

export interface ParsedTrashInfo {
  originalPath?: string;
  deletedMs?: number;
  /** Set when the original location cannot be trusted or read. */
  problem?: string;
}

export interface ResolvedTrashItem extends ParsedTrashInfo {
  dir: TrashDir;
  name: string;
  /** `<trash dir>/files/<name>` */
  trashedPath: string;
  infoPath?: string;
  stat: fs.Stats;
}

export interface TrashStoreOptions {
  /** The home trash directory. Defaults to $XDG_DATA_HOME/Trash or ~/.local/share/Trash. */
  homeTrash: string;
  /** Mount points whose per-drive trash directories are read. */
  topdirs?: () => Promise<string[]>;
  /** Owner of the trash directories (process uid by default). */
  uid?: number;
}

/** True for a name that is a single, ordinary path component. */
export function isSafeTrashName(name: string): boolean {
  return !!name && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\') && !name.includes('\0') && name.length <= 1024;
}

/** Local date-time `YYYY-MM-DDThh:mm:ss` → epoch ms, or undefined when malformed. */
export function parseDeletionDate(value: string | undefined): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value ?? '');
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi, s);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || date.getHours() !== h || date.getMinutes() !== mi) return undefined;
  return date.getTime();
}

/** Format a time as a spec DeletionDate (local time, no zone). */
export function formatDeletionDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Percent-encode a path for `Path=` the way GLib does (keeps '/', unreserved and a few safe characters). */
export function encodeTrashPath(p: string): string {
  return Array.from(Buffer.from(p, 'utf8'))
    .map((b) => {
      const c = String.fromCharCode(b);
      return /[A-Za-z0-9\-._~/!$&'()*+,;=:@]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
}

/**
 * Parse a .trashinfo file. Unknown keys and other groups are ignored; a
 * missing header, a missing or undecodable Path, `..` segments, a Path outside
 * the drive (volume trashes) or inside the trash directory yield a `problem`
 * instead of an original location.
 */
export function parseTrashInfo(text: string, dir: Pick<TrashDir, 'kind' | 'topdir' | 'base' | 'path'>): ParsedTrashInfo {
  let inGroup = false;
  let sawHeader = false;
  let rawPath: string | undefined;
  let rawDate: string | undefined;
  for (const line0 of text.split(/\r?\n/)) {
    const line = line0.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      inGroup = line === '[Trash Info]';
      if (inGroup) sawHeader = true;
      continue;
    }
    if (!inGroup) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === 'Path' && rawPath === undefined) rawPath = value;
    else if (key === 'DeletionDate' && rawDate === undefined) rawDate = value;
  }
  const deletedMs = parseDeletionDate(rawDate);
  if (!sawHeader) return { deletedMs, problem: 'Its .trashinfo file is not in the Trash format, so its original location is unknown.' };
  if (!rawPath) return { deletedMs, problem: 'Its original location was not recorded.' };
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { deletedMs, problem: 'Its recorded original location is not valid, so it is not used.' };
  }
  if (!decoded || decoded.includes('\0')) return { deletedMs, problem: 'Its recorded original location is not valid, so it is not used.' };
  if (decoded.split('/').includes('..')) return { deletedMs, problem: 'Its recorded original location contains “..”, so it is not trusted.' };
  const resolved = path.isAbsolute(decoded) ? path.resolve(decoded) : path.resolve(dir.base, decoded);
  if (dir.kind === 'volume' && (!isWithin(dir.topdir, resolved, false) || path.resolve(dir.topdir) === resolved)) {
    return { deletedMs, problem: 'Its recorded original location is outside the drive this Trash belongs to, so it is not trusted.' };
  }
  if (isWithin(dir.path, resolved, false)) return { deletedMs, problem: 'Its recorded original location is inside the Trash itself, so it is not trusted.' };
  if (path.parse(resolved).root === resolved) return { deletedMs, problem: 'Its recorded original location is a drive root, so it is not used.' };
  return { originalPath: resolved, deletedMs };
}

export function defaultHomeTrash(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_DATA_HOME;
  const dataHome = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, 'Trash');
}

async function lstatOrUndefined(p: string): Promise<fs.Stats | undefined> {
  return fsp.lstat(p).catch(() => undefined);
}

function kindOf(st: fs.Stats): EntryKind {
  if (st.isSymbolicLink()) return 'symlink';
  if (st.isDirectory()) return 'directory';
  if (st.isFile()) return 'file';
  return 'other';
}

/** Total bytes under a folder without following links, bounded. */
async function boundedSize(root: string, signal?: AbortSignal): Promise<{ bytes: number; complete: boolean }> {
  let bytes = 0;
  let count = 0;
  let complete = true;
  const stack = [root];
  while (stack.length) {
    if (signal?.aborted) return { bytes, complete: false };
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      complete = false;
      continue;
    }
    for (const e of entries) {
      if (++count > MAX_SIZE_ENTRIES) return { bytes, complete: false };
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        const st = await lstatOrUndefined(p);
        if (st) bytes += st.size;
        else complete = false;
      }
    }
  }
  return { bytes, complete };
}

export class TrashStore {
  readonly homeTrash: string;
  private readonly topdirs: () => Promise<string[]>;
  private readonly uid: number | undefined;
  private watchers = new Map<string, fs.FSWatcher>();
  private topCache: { at: number; tops: string[] } | undefined;

  constructor(opts: TrashStoreOptions) {
    this.homeTrash = path.resolve(opts.homeTrash);
    this.topdirs = opts.topdirs ?? (async () => []);
    this.uid = opts.uid ?? process.getuid?.();
  }

  /** The trash directories of the current user that exist and pass the specification's checks. */
  async dirs(): Promise<TrashDir[]> {
    const out: TrashDir[] = [];
    const seen = new Set<string>();
    const add = async (p: string, kind: TrashDir['kind'], topdir: string) => {
      const st = await lstatOrUndefined(p);
      // A link in place of a trash directory is never followed.
      if (!st?.isDirectory()) return;
      if (this.uid !== undefined && st.uid !== this.uid) return;
      const key = `${st.dev}:${st.ino}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ path: p, kind, topdir, base: kind === 'home' ? path.dirname(p) : topdir });
    };
    await add(this.homeTrash, 'home', path.dirname(this.homeTrash));
    // The drive list is read at most every few seconds (trashing many items asks for it per item).
    if (!this.topCache || Date.now() - this.topCache.at > 3000) {
      let read: string[] = [];
      try {
        read = await this.topdirs();
      } catch {
        read = [];
      }
      this.topCache = { at: Date.now(), tops: read };
    }
    const tops = this.topCache.tops;
    for (const top of [...new Set(tops.map((t) => path.resolve(t)))]) {
      if (this.uid === undefined) continue;
      const admin = path.join(top, '.Trash');
      const ast = await lstatOrUndefined(admin);
      if (ast?.isDirectory() && (ast.mode & 0o1000) !== 0) await add(path.join(admin, String(this.uid)), 'volume', top);
      await add(path.join(top, `.Trash-${this.uid}`), 'volume', top);
    }
    return out;
  }

  /** files/ and info/ of a trash directory, when they are real directories (or absent). */
  private async subdirs(dir: TrashDir): Promise<{ files: string; info: string; problem?: string }> {
    const files = path.join(dir.path, 'files');
    const info = path.join(dir.path, 'info');
    for (const p of [files, info]) {
      const st = await lstatOrUndefined(p);
      if (st && !st.isDirectory()) return { files, info, problem: `${p} is not a folder (it may be a link), so this Trash was not read.` };
    }
    return { files, info };
  }

  private async readInfo(infoPath: string, dir: TrashDir): Promise<ParsedTrashInfo & { mtimeMs?: number }> {
    const st = await lstatOrUndefined(infoPath);
    if (!st) return { problem: 'No .trashinfo file was found, so its original location is unknown.' };
    if (!st.isFile()) return { problem: 'Its .trashinfo entry is not a regular file, so it was not read.' };
    if (st.size > MAX_INFO_BYTES) return { problem: 'Its .trashinfo file is unusually large, so it was not read.', mtimeMs: st.mtimeMs };
    let text: string;
    try {
      text = await fsp.readFile(infoPath, 'utf8');
    } catch {
      return { problem: 'Its .trashinfo file could not be read.', mtimeMs: st.mtimeMs };
    }
    return { ...parseTrashInfo(text, dir), mtimeMs: st.mtimeMs };
  }

  /** List every item in every trash directory. Malformed entries are listed with a problem, never skipped silently. */
  async list(signal?: AbortSignal): Promise<{ dirs: TrashDir[]; items: TrashItem[]; problems: string[] }> {
    const dirs = await this.dirs();
    const items: TrashItem[] = [];
    const problems: string[] = [];
    for (const dir of dirs) {
      const sub = await this.subdirs(dir);
      if (sub.problem) {
        problems.push(sub.problem);
        continue;
      }
      const fileNames = await fsp.readdir(sub.files).catch(() => [] as string[]);
      const infoNames = new Set((await fsp.readdir(sub.info).catch(() => [] as string[])).filter((n) => n.endsWith(INFO_EXT)));
      for (const name of fileNames) {
        if (signal?.aborted) break;
        if (!isSafeTrashName(name)) continue;
        const trashedPath = path.join(sub.files, name);
        const st = await lstatOrUndefined(trashedPath);
        if (!st) continue;
        const info = infoNames.has(name + INFO_EXT) ? await this.readInfo(path.join(sub.info, name + INFO_EXT), dir) : { problem: 'No .trashinfo file was found, so its original location is unknown.' };
        const kind = kindOf(st);
        let size: number | undefined;
        let sizeComplete = true;
        if (kind === 'file') size = st.size;
        else if (kind === 'directory') {
          const t = await boundedSize(trashedPath, signal);
          size = t.bytes;
          sizeComplete = t.complete;
        }
        items.push({ id: trashedPath, trashDir: dir.path, name, originalPath: info.originalPath, deletedMs: info.deletedMs, kind, size, sizeComplete, problem: info.problem });
      }
    }
    return { dirs, items, problems };
  }

  /**
   * Validate a path inside the Trash and read its record. The path must be
   * exactly `<known trash dir>/files/<name>` and still exist.
   */
  async resolve(trashedPath: string): Promise<ResolvedTrashItem> {
    if (!path.isAbsolute(trashedPath)) throw makeError('validation', 'trash.resolve', { message: 'The item is not identified by an absolute path.' });
    const abs = path.resolve(trashedPath);
    const name = path.basename(abs);
    if (!isSafeTrashName(name)) throw makeError('validation', 'trash.resolve', { message: 'This is not a valid Trash item.', target: abs });
    const dirs = await this.dirs();
    const dir = dirs.find((d) => path.join(d.path, 'files') === path.dirname(abs));
    if (!dir) throw makeError('validation', 'trash.resolve', { message: 'This item is not in a Trash folder Orbis Files manages.', target: abs });
    const sub = await this.subdirs(dir);
    if (sub.problem) throw makeError('permission_denied', 'trash.resolve', { message: sub.problem, target: abs });
    const stat = await lstatOrUndefined(abs);
    if (!stat) throw makeError('not_found', 'trash.resolve', { message: 'It is no longer in the Trash (it was restored, deleted or the Trash was emptied).', target: abs });
    const infoPath = path.join(sub.info, name + INFO_EXT);
    const info = await this.readInfo(infoPath, dir);
    const infoExists = !!(await lstatOrUndefined(infoPath))?.isFile();
    return { dir, name, trashedPath: abs, infoPath: infoExists ? infoPath : undefined, originalPath: info.originalPath, deletedMs: info.deletedMs, problem: info.problem, stat };
  }

  /**
   * Find the entry a trash call just created for `original`: the newest entry
   * whose recorded Path is that path and that was written no earlier than
   * `sinceMs` − 2 s; otherwise the newest recent entry with the same name.
   * "Written" is the .trashinfo file's own modification time — the same clock
   * as `sinceMs`. DeletionDate is local time without a zone, written by
   * whichever process did the trashing, so a time-zone difference between that
   * process and this one would make it hours off; it is only a fallback.
   */
  async locate(original: string, sinceMs: number): Promise<{ trashDir: string; name: string; trashedPath: string } | undefined> {
    const target = path.resolve(original);
    const base = path.basename(target);
    const stem = path.parse(base).name || base;
    const cutoff = sinceMs - 2000;
    let exact: { dir: TrashDir; name: string; t: number } | undefined;
    let byName: typeof exact;
    const consider = async (dir: TrashDir, infoDir: string, filesDir: string, file: string) => {
      const name = file.slice(0, -INFO_EXT.length);
      if (!isSafeTrashName(name)) return;
      const info = await this.readInfo(path.join(infoDir, file), dir);
      const t = info.mtimeMs ?? info.deletedMs ?? 0;
      if (t < cutoff || !info.originalPath) return;
      if (!(await lstatOrUndefined(path.join(filesDir, name)))) return;
      if (info.originalPath === target) {
        if (!exact || t > exact.t) exact = { dir, name, t };
      } else if (path.basename(info.originalPath) === base) {
        if (!byName || t > byName.t) byName = { dir, name, t };
      }
    };
    const dirs = await this.dirs();
    const listings: Array<{ dir: TrashDir; info: string; files: string; names: string[] }> = [];
    for (const dir of dirs) {
      const sub = await this.subdirs(dir);
      if (sub.problem) continue;
      const names = (await fsp.readdir(sub.info).catch(() => [] as string[])).filter((n) => n.endsWith(INFO_EXT));
      listings.push({ dir, info: sub.info, files: sub.files, names });
      // Trash implementations name the entry after the item (adding a number when the name is taken).
      for (const n of names) if (n.startsWith(stem)) await consider(dir, sub.info, sub.files, n);
    }
    if (!exact && !byName) {
      // Renamed beyond recognition: check entries written since the operation started.
      for (const l of listings) {
        for (const n of l.names) {
          if (n.startsWith(stem)) continue;
          const st = await lstatOrUndefined(path.join(l.info, n));
          if (st && st.mtimeMs >= cutoff) await consider(l.dir, l.info, l.files, n);
        }
      }
    }
    const hit = exact ?? byName;
    return hit ? { trashDir: hit.dir.path, name: hit.name, trashedPath: path.join(hit.dir.path, 'files', hit.name) } : undefined;
  }

  /**
   * Move a trashed item to `target` without ever replacing what is there,
   * then remove its .trashinfo. Throws already_exists when `target` exists.
   */
  async restore(item: ResolvedTrashItem, target: string): Promise<void> {
    if (!path.isAbsolute(target)) throw makeError('validation', 'trash.restore', { message: 'The destination must be an absolute path.' });
    const dest = path.resolve(target);
    if (isWithin(item.dir.path, dest, false)) throw makeError('validation', 'trash.restore', { message: 'An item cannot be restored into the Trash.', target: dest });
    const parent = path.dirname(dest);
    const pst = await fsp.stat(parent).catch(() => undefined);
    if (!pst?.isDirectory()) {
      throw makeError('not_found', 'trash.restore', { message: `The folder ${parent} no longer exists. Use Restore to… to choose another folder.`, target: parent });
    }
    await moveNoClobber(item.trashedPath, dest, 'trash.restore');
    await this.forget(item);
  }

  /** Permanently delete a trashed item and its .trashinfo. Links inside it are removed, never followed. */
  async deletePermanently(item: ResolvedTrashItem): Promise<void> {
    await fsp.rm(item.trashedPath, { recursive: true, force: false, maxRetries: 2 }).catch((err) => {
      throw new OrbisError(toOrbisError(err, 'trash.delete', item.trashedPath, 'unknown'));
    });
    await this.forget(item);
  }

  /** Remove the .trashinfo and the directorysizes cache line of an item that left the Trash. */
  private async forget(item: ResolvedTrashItem): Promise<void> {
    if (item.infoPath) await fsp.unlink(item.infoPath).catch(() => undefined);
    await pruneDirectorySizes(item.dir.path, item.name).catch(() => undefined);
  }

  /** Watch each trash directory (and its info/ folder) and call `onChange` when it changes. */
  watch(dirs: TrashDir[], onChange: () => void): void {
    const wanted = new Set<string>();
    for (const d of dirs) for (const p of [d.path, path.join(d.path, 'info')]) wanted.add(p);
    for (const [p, w] of this.watchers) {
      if (!wanted.has(p)) {
        w.close();
        this.watchers.delete(p);
      }
    }
    for (const p of wanted) {
      if (this.watchers.has(p)) continue;
      try {
        const w = fs.watch(p, { persistent: false }, () => onChange());
        w.on('error', () => {
          w.close();
          this.watchers.delete(p);
        });
        this.watchers.set(p, w);
      } catch {
        /* missing (e.g. info/ before the first deletion) or not watchable; refresh after operations instead */
      }
    }
  }

  close(): void {
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }
}

/** The current user's Trash (home trash plus per-drive trashes on mounted drives). */
export function trashForCurrentUser(topdirs: () => Promise<string[]>): TrashStore {
  return new TrashStore({ homeTrash: defaultHomeTrash(), topdirs });
}

/** Remove the cached size line for `name` from a trash directory's `directorysizes` file (best effort). */
async function pruneDirectorySizes(trashDir: string, name: string): Promise<void> {
  const file = path.join(trashDir, 'directorysizes');
  const st = await lstatOrUndefined(file);
  if (!st?.isFile() || st.size > 16 * 1024 * 1024) return;
  const text = await fsp.readFile(file, 'utf8');
  const lines = text.split('\n');
  const kept = lines.filter((line) => {
    const parts = line.split(' ');
    if (parts.length < 3) return true;
    try {
      return decodeURIComponent(parts.slice(2).join(' ')) !== name;
    } catch {
      return true;
    }
  });
  if (kept.length === lines.length) return;
  const tmp = path.join(trashDir, `.directorysizes-${crypto.randomUUID()}`);
  await fsp.writeFile(tmp, kept.join('\n'), { flag: 'wx' });
  await fsp.rename(tmp, file);
}

const NO_HARDLINK = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK', 'EACCES']);

/**
 * Move `src` to `dst` without replacing anything at `dst`:
 *  - folders: create `dst` exclusively, then rename over that empty folder;
 *  - files and links: hard-link (fails if `dst` exists), then unlink the source;
 *  - across drives: copy (links copied as links), verify, then remove the source.
 */
export async function moveNoClobber(src: string, dst: string, operation = 'trash.restore'): Promise<void> {
  const exists = () => makeError('already_exists', operation, { message: `“${path.basename(dst)}” already exists in ${path.dirname(dst)} and was not replaced.`, target: dst });
  const st = await fsp.lstat(src);
  if (st.isDirectory()) {
    try {
      await fsp.mkdir(dst);
    } catch (err) {
      if ((err as { code?: string }).code === 'EEXIST') throw exists();
      throw new OrbisError(toOrbisError(err, operation, dst, 'no'));
    }
    try {
      await fsp.rename(src, dst); // replaces only the empty folder created just above
      return;
    } catch (err) {
      if ((err as { code?: string }).code !== 'EXDEV') {
        await fsp.rmdir(dst).catch(() => undefined);
        throw new OrbisError(toOrbisError(err, operation, src, 'no'));
      }
    }
    try {
      await fsp.cp(src, dst, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true, preserveTimestamps: true });
    } catch (err) {
      throw new OrbisError({ ...toOrbisError(err, operation, src, 'partial'), message: 'The folder could not be copied to the other drive completely. The item is still in the Trash; a partial copy may remain at the destination.' });
    }
    const [a, b] = await Promise.all([countTree(src), countTree(dst)]);
    if (a.bytes !== b.bytes || a.items !== b.items) {
      throw makeError('io', operation, { message: 'The copy on the other drive could not be verified, so the item was kept in the Trash.', target: dst, dataChanged: 'yes', retryable: true });
    }
    await fsp.rm(src, { recursive: true, force: false });
    return;
  }
  try {
    await fsp.link(src, dst); // never follows a link and fails rather than replace
    await fsp.unlink(src);
    return;
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (code === 'EEXIST') throw exists();
    if (code === 'EXDEV') {
      if (st.isSymbolicLink()) {
        await fsp.symlink(await fsp.readlink(src), dst).catch((e) => {
          if ((e as { code?: string }).code === 'EEXIST') throw exists();
          throw new OrbisError(toOrbisError(e, operation, dst, 'no'));
        });
      } else if (st.isFile()) {
        await fsp.copyFile(src, dst, fs.constants.COPYFILE_EXCL).catch((e) => {
          if ((e as { code?: string }).code === 'EEXIST') throw exists();
          throw new OrbisError(toOrbisError(e, operation, dst, 'no'));
        });
        const copied = await fsp.lstat(dst);
        if (copied.size !== st.size) {
          await fsp.unlink(dst).catch(() => undefined);
          throw makeError('io', operation, { message: 'The copy on the other drive could not be verified, so the item was kept in the Trash.', target: dst, retryable: true });
        }
        await fsp.utimes(dst, st.atime, st.mtime).catch(() => undefined);
      } else {
        throw makeError('unsupported', operation, { message: 'Special files (devices, sockets, pipes) cannot be moved to another drive.', target: src });
      }
      await fsp.unlink(src);
      return;
    }
    if (NO_HARDLINK.has(code)) {
      // No hard links on this file system: check, then rename.
      if (await lstatOrUndefined(dst)) throw exists();
      await fsp.rename(src, dst).catch((e) => {
        throw new OrbisError(toOrbisError(e, operation, src, 'no'));
      });
      return;
    }
    throw new OrbisError(toOrbisError(err, operation, src, 'no'));
  }
}

async function countTree(root: string): Promise<{ bytes: number; items: number }> {
  let bytes = 0;
  let items = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      items++;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) bytes += (await fsp.lstat(p)).size;
    }
  }
  return { bytes, items };
}
