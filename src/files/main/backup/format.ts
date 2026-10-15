import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeError } from '../../shared/errors';
import {
  isSafeVersionRel,
  parseVersionName,
  VERSION_NAME_RE,
  type ManifestEntry,
  type VersionInfo,
  type VersionManifest,
} from '../../shared/backup';
import { isWithin } from '../fs/paths';

/**
 * The backup store on disk (format version 1). Self-describing, readable
 * without Orbis Files:
 *
 *   <store>/orbis-backup.json                 store descriptor (job id, format, explanation)
 *   <store>/2026-10-12_093000/                one folder per run (local start time)
 *   <store>/2026-10-12_093000/<label>/…       hard-link mode: the full tree of each source
 *   <store>/2026-10-12_093000/.orbis-manifest.json   written LAST, atomically: the version is complete
 *   <store>/objects/ab/<sha256>               object mode (drives without hard links): file contents, stored once
 *
 * A version folder without a valid manifest is incomplete: it is never used as
 * the base for unchanged files and never counted or removed by retention.
 */

export const DESCRIPTOR = 'orbis-backup.json';
export const MANIFEST = '.orbis-manifest.json';
export const OBJECTS = 'objects';
export const PART_PREFIX = '.orbis-part-';

export interface StoreDescriptor {
  format: 'orbis-backup-store';
  formatVersion: 1;
  jobId: string;
  jobName: string;
  createdMs: number;
  about: string;
}

const ABOUT =
  'Backup store made by Orbis Files. Each folder named YYYY-MM-DD_HHMMSS is one version (local start time). ' +
  'A version is complete only when it contains .orbis-manifest.json, which lists every item with its size, modification time and SHA-256. ' +
  'In hard-link mode a version folder holds the full tree of each source and unchanged files are hard links to the same file in the previous version. ' +
  'On drives without hard links, file contents are stored once in objects/<first two hex digits>/<sha256> and the manifest says which object each file uses.';

/** Write a file atomically: temporary sibling → fsync → rename → fsync the folder. */
export async function writeFileAtomic(target: string, data: string | Buffer): Promise<void> {
  const tmp = path.join(path.dirname(target), `${PART_PREFIX}${crypto.randomUUID()}`);
  const fh = await fsp.open(tmp, 'wx', 0o644);
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await fsp.rename(tmp, target);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  await fsyncDir(path.dirname(target));
}

export async function fsyncDir(dir: string): Promise<void> {
  if (process.platform === 'win32') return;
  const fh = await fsp.open(dir, 'r').catch(() => undefined);
  if (!fh) return;
  await fh.sync().catch(() => undefined);
  await fh.close().catch(() => undefined);
}

export async function readDescriptor(store: string): Promise<StoreDescriptor | undefined> {
  const raw = await fsp.readFile(path.join(store, DESCRIPTOR), 'utf8').catch((err) => {
    if ((err as { code?: string }).code === 'ENOENT') return undefined;
    throw err;
  });
  if (raw === undefined) return undefined;
  let d: unknown;
  try {
    d = JSON.parse(raw);
  } catch {
    throw makeError('validation', 'backup.store', { message: `The backup store's ${DESCRIPTOR} cannot be read. Nothing was changed.`, target: store });
  }
  const o = d as Partial<StoreDescriptor>;
  if (o?.format !== 'orbis-backup-store' || o.formatVersion !== 1 || typeof o.jobId !== 'string') {
    throw makeError('validation', 'backup.store', { message: `${DESCRIPTOR} in this folder is not an Orbis Files backup store of a known version. Nothing was changed.`, target: store });
  }
  return o as StoreDescriptor;
}

/**
 * Make sure `store` is this job's backup store, creating it when needed. The
 * destination folder itself must exist (a drive that is not connected is not
 * silently replaced by an empty folder). A non-empty folder that is not a store
 * of this job is refused.
 */
export async function ensureStore(store: string, job: { id: string; name: string }, now: number): Promise<StoreDescriptor> {
  const dest = path.dirname(store);
  const dst = await fsp.stat(dest).catch(() => undefined);
  if (!dst?.isDirectory()) throw makeError('not_found', 'backup.store', { message: `The destination folder ${dest} is not available. Is the drive connected?`, target: dest });
  const st = await fsp.lstat(store).catch(() => undefined);
  if (st && !st.isDirectory()) throw makeError('not_a_directory', 'backup.store', { message: 'The backup store path is not a folder.', target: store });
  if (!st) await fsp.mkdir(store);
  const desc = await readDescriptor(store);
  if (desc) {
    if (desc.jobId !== job.id) throw makeError('validation', 'backup.store', { message: `${store} holds the backups of another job (“${desc.jobName}”). Nothing was changed.`, target: store });
    return desc;
  }
  const names = (await fsp.readdir(store)).filter((n) => !n.startsWith(PART_PREFIX));
  if (names.length) throw makeError('validation', 'backup.store', { message: `${store} is not empty and is not an Orbis Files backup store. Choose another destination; nothing was changed.`, target: store });
  const created: StoreDescriptor = { format: 'orbis-backup-store', formatVersion: 1, jobId: job.id, jobName: job.name, createdMs: now, about: ABOUT };
  await writeFileAtomic(path.join(store, DESCRIPTOR), JSON.stringify(created, null, 2));
  return created;
}

/** Whether hard links can be made in `dir` (probed on disk, not guessed from the platform). */
export async function probeHardLinks(dir: string): Promise<boolean> {
  const a = path.join(dir, `${PART_PREFIX}probe-${crypto.randomUUID()}`);
  const b = `${a}-link`;
  try {
    await fsp.writeFile(a, 'orbis', { flag: 'wx' });
    await fsp.link(a, b);
    const [sa, sb] = await Promise.all([fsp.lstat(a), fsp.lstat(b)]);
    return sa.ino === sb.ino && sa.dev === sb.dev && sa.nlink >= 2;
  } catch {
    return false;
  } finally {
    await fsp.rm(a, { force: true }).catch(() => undefined);
    await fsp.rm(b, { force: true }).catch(() => undefined);
  }
}

export function objectPath(store: string, sha: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha)) throw makeError('validation', 'backup.object', { message: 'A manifest names an object that is not a SHA-256.' });
  return path.join(store, OBJECTS, sha.slice(0, 2), sha);
}

/** Absolute path of an entry's copy in a hard-link version. */
export function treePath(store: string, version: string, rel: string): string {
  if (!VERSION_NAME_RE.test(version)) throw makeError('validation', 'backup.path', { message: 'Not a backup version name.', target: version });
  if (!isSafeVersionRel(rel)) throw makeError('invalid_path', 'backup.path', { message: 'A path in the backup is not allowed.', target: rel });
  const base = path.join(store, version);
  const p = path.join(base, ...rel.split('/'));
  if (!isWithin(base, p) || p === base) throw makeError('invalid_path', 'backup.path', { message: 'The path would leave the backup version.', target: rel });
  return p;
}

/** Where the contents of a file entry are stored in this version. */
export function dataPath(store: string, m: Pick<VersionManifest, 'storage' | 'version'>, e: ManifestEntry): string {
  if (m.storage === 'objects') {
    if (!e.h) throw makeError('validation', 'backup.object', { message: `“${e.p}” has no stored contents in this version.`, target: e.p });
    return objectPath(store, e.h);
  }
  return treePath(store, m.version, e.p);
}

// ------------------------------------------------------------------ manifests

const cache = new Map<string, { mtimeMs: number; size: number; manifest: VersionManifest }>();

/** Parse and check a manifest; undefined (with a reason) when it is not usable. */
export async function readManifest(store: string, version: string, jobId: string): Promise<{ manifest?: VersionManifest; problem?: string }> {
  if (!VERSION_NAME_RE.test(version)) return { problem: 'Not a backup version name.' };
  const file = path.join(store, version, MANIFEST);
  const st = await fsp.lstat(file).catch(() => undefined);
  if (!st) return { problem: 'Incomplete: the run did not finish (no manifest).' };
  if (!st.isFile()) return { problem: 'The manifest is not a regular file.' };
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return { manifest: hit.manifest };
  let m: VersionManifest;
  try {
    m = JSON.parse(await fsp.readFile(file, 'utf8')) as VersionManifest;
  } catch {
    return { problem: 'The manifest cannot be read.' };
  }
  if (m?.format !== 'orbis-backup-manifest' || m.formatVersion !== 1) return { problem: 'The manifest has an unknown format.' };
  if (m.jobId !== jobId) return { problem: 'The manifest belongs to another backup job.' };
  if (m.version !== version) return { problem: 'The manifest names another version.' };
  if (m.storage !== 'hardlink' && m.storage !== 'objects') return { problem: 'The manifest has an unknown storage mode.' };
  if (!Array.isArray(m.entries) || !Array.isArray(m.sources) || typeof m.startedMs !== 'number') return { problem: 'The manifest is incomplete.' };
  // Entries with unsafe paths are dropped (never followed out of the version or the restore target).
  m.entries = m.entries.filter((e) => e && typeof e.p === 'string' && isSafeVersionRel(e.p) && (e.k === 'f' || e.k === 'd' || e.k === 'l') && (e.k !== 'f' || typeof e.s === 'number'));
  m.sources = m.sources.filter((s) => s && typeof s.label === 'string' && isSafeVersionRel(s.label) && !s.label.includes('/') && typeof s.path === 'string' && path.isAbsolute(s.path));
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, manifest: m });
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  return { manifest: m };
}

/** Every version folder in the store, newest first, complete or not. */
export async function listVersions(store: string, jobId: string): Promise<Array<VersionInfo & { manifest?: VersionManifest }>> {
  const names = await fsp.readdir(store).catch((err) => {
    if ((err as { code?: string }).code === 'ENOENT') return [] as string[];
    throw err;
  });
  const out: Array<VersionInfo & { manifest?: VersionManifest }> = [];
  for (const name of names) {
    const t = parseVersionName(name);
    if (t === undefined) continue;
    const st = await fsp.lstat(path.join(store, name)).catch(() => undefined);
    if (!st?.isDirectory()) continue;
    const { manifest, problem } = await readManifest(store, name, jobId);
    out.push(manifest
      ? { name, startedMs: manifest.startedMs, finishedMs: manifest.finishedMs, complete: true, storage: manifest.storage, stats: manifest.stats, sources: manifest.sources, manifest }
      : { name, startedMs: t, complete: false, problem });
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

/** Source labels: folder names, made unique ("Documents", "Documents (2)"), never reserved names. */
export function sourceLabels(sources: string[]): string[] {
  const used = new Set<string>();
  return sources.map((s) => {
    let base = path.basename(path.resolve(s)) || 'Drive';
    if (base.startsWith('.orbis') || base === OBJECTS || base === DESCRIPTOR || base.startsWith('.')) base = `_${base}`;
    let label = base;
    for (let i = 2; used.has(label.toLowerCase()); i++) label = `${base} (${i})`;
    used.add(label.toLowerCase());
    return label;
  });
}

/** Remove a version folder (retention or an interrupted run of this session). Guarded to the store. */
export async function removeVersionDir(store: string, version: string): Promise<void> {
  if (!VERSION_NAME_RE.test(version)) throw makeError('validation', 'backup.remove', { message: 'Not a backup version name.', target: version });
  const dir = path.join(store, version);
  if (!isWithin(store, dir) || dir === path.resolve(store)) throw makeError('invalid_path', 'backup.remove', { target: dir });
  const st = await fsp.lstat(dir).catch(() => undefined);
  if (!st?.isDirectory()) return;
  // Make read-only copies removable inside the version only.
  await fsp.rm(dir, { recursive: true, force: true, maxRetries: 2 });
  cache.delete(path.join(dir, MANIFEST));
}

export function realpathOr(p: string): Promise<string> {
  return fsp.realpath(p).catch(() => path.resolve(p));
}
