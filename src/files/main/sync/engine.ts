import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeError } from '../../shared/errors';
import {
  isSafeRel,
  type ConflictChoice,
  type SyncAction,
  type SyncActionKind,
  type SyncConflictType,
  type SyncEntryInfo,
  type SyncItemKind,
  type SyncMode,
  type SyncOptions,
  type SyncSide,
} from '../../shared/sync';
import { isWithin } from '../fs/paths';
import { makeFilter, type PathFilter } from './glob';

/**
 * Folder synchronization planning. Both folders are walked without following
 * symbolic links; every item is classified into an action (copy, update,
 * delete to the Trash, conflict) with a reason. Nothing is changed here.
 *
 * Change detection: size and modification time (within a tolerance), plus
 * SHA-256 when "verify" is on. Two-way mode compares each side with the
 * stored baseline (the state after the last synchronization).
 */

/** Temporary files written by Orbis Files while copying; never synchronized. */
export const PART_PREFIX = '.orbis-part-';

export interface ScanEntry {
  key: string;
  rel: string;
  name: string;
  kind: SyncItemKind;
  size: number;
  mtimeMs: number;
  linkTarget?: string;
}

export interface SideScan {
  root: string;
  entries: Map<string, ScanEntry>;
  /** Spelling of every folder walked (in scope or only searched for included items), by key. */
  dirRels: Map<string, string>;
  /** Keys where two names differ only in case (or Unicode normalisation) while names are matched ignoring it. */
  collisions: Set<string>;
  /** Keys that could not be read (folders that could not be listed, items that could not be inspected). */
  unreadable: Set<string>;
  /** Folders that contain, at any depth, something outside the synchronization (never removed as a whole). */
  holdsOutOfScope: Set<string>;
  /** Links left alone ("skip links") and special files, by key: never synchronized, and nothing is written over them. */
  untouchable: Set<string>;
  excluded: number;
  symlinksSkipped: number;
  special: number;
  errors: string[];
}

/** Waits while paused; throws `cancelled` when stopped. */
export type Checkpoint = () => Promise<void>;

export interface BaselineRow {
  rel: string;
  kind: SyncItemKind;
  size?: number;
  leftMtimeMs: number;
  rightMtimeMs: number;
  sha256?: string;
  linkTarget?: string;
}

export interface Baseline {
  rows: BaselineRow[];
  updatedMs: number;
}

export interface PlanAction extends SyncAction {
  key: string;
  /** Path of the item on each side (for a side where it does not exist yet: where it will be created). */
  leftRel: string;
  rightRel: string;
  /** Mirror: this copy replaces an item of another kind that is removed first. */
  replaces?: boolean;
}

export interface InSyncItem {
  key: string;
  l: ScanEntry;
  r: ScanEntry;
}

export interface PlanResult {
  left: string;
  right: string;
  mode: SyncMode;
  options: SyncOptions;
  caseInsensitive: boolean;
  actions: PlanAction[];
  inSync: InSyncItem[];
  leftScan: SideScan;
  rightScan: SideScan;
  baselineKeys: Map<string, BaselineRow>;
  extraKept: number;
  notCompared: number;
  notes: string[];
}

export interface PlanInput {
  left: string;
  right: string;
  mode: SyncMode;
  options: SyncOptions;
  baseline?: Baseline;
  checkpoint: Checkpoint;
  signal: AbortSignal;
  hashes: HashCache;
  onProgress?: (p: { stage: 'scanning' | 'comparing'; done: number; total?: number }) => void;
}

// ------------------------------------------------------------------ helpers

export function keyOf(rel: string, caseInsensitive: boolean): string {
  const n = rel.normalize('NFC');
  return caseInsensitive ? n.toLowerCase() : n;
}

export function parentKey(key: string): string {
  const i = key.lastIndexOf('/');
  return i < 0 ? '' : key.slice(0, i);
}

function baseName(rel: string): string {
  return rel.slice(rel.lastIndexOf('/') + 1);
}

function dirName(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

/** Absolute path of a relative plan path under a root. Refuses anything that is not a plain relative path. */
export function absIn(root: string, rel: string, operation = 'sync.path'): string {
  if (!isSafeRel(rel)) throw makeError('invalid_path', operation, { message: 'The item has a path that is not allowed inside the synchronized folder.', target: rel });
  const p = path.join(root, ...rel.split('/'));
  if (!isWithin(root, p) || p === path.resolve(root)) throw makeError('invalid_path', operation, { message: 'The path would leave the synchronized folder.', target: rel });
  return p;
}

export function info(e: ScanEntry): SyncEntryInfo {
  return { kind: e.kind, size: e.kind === 'file' ? e.size : undefined, mtimeMs: e.mtimeMs, linkTarget: e.linkTarget };
}

/** SHA-256 results for this run, keyed by path, size and modification time. */
export class HashCache {
  private map = new Map<string, { size: number; mtimeMs: number; sha: string }>();

  peek(abs: string, size: number, mtimeMs: number): string | undefined {
    const h = this.map.get(abs);
    return h && h.size === size && h.mtimeMs === mtimeMs ? h.sha : undefined;
  }

  put(abs: string, size: number, mtimeMs: number, sha: string): void {
    this.map.set(abs, { size, mtimeMs, sha });
  }

  async get(abs: string, size: number, mtimeMs: number, signal: AbortSignal, checkpoint: Checkpoint): Promise<string> {
    const known = this.peek(abs, size, mtimeMs);
    if (known) return known;
    await checkpoint();
    const h = crypto.createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      const s = fs.createReadStream(abs, { highWaterMark: 1024 * 1024, signal });
      s.on('data', (c) => h.update(c as Buffer));
      s.on('end', resolve);
      s.on('error', reject);
    }).catch((err) => {
      if (signal.aborted) throw makeError('cancelled', 'sync.hash');
      throw err;
    });
    const sha = h.digest('hex');
    this.put(abs, size, mtimeMs, sha);
    return sha;
  }
}

function swapCase(s: string): string {
  let out = '';
  for (const c of s) out += c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase();
  return out;
}

/** Whether names in this folder are matched ignoring letter case (checked on disk, not guessed from the platform when possible). */
export async function probeCaseInsensitive(root: string): Promise<boolean> {
  const tryName = async (dir: string, name: string): Promise<boolean | undefined> => {
    const swapped = swapCase(name);
    if (swapped === name) return undefined;
    const [a, b] = await Promise.all([fsp.lstat(path.join(dir, swapped)).catch(() => undefined), fsp.lstat(path.join(dir, name)).catch(() => undefined)]);
    if (!b) return undefined;
    if (!a) return false;
    return a.ino === b.ino && a.dev === b.dev;
  };
  const base = path.basename(root);
  if (base) {
    const r = await tryName(path.dirname(root), base);
    if (r !== undefined) return r;
  }
  const names = await fsp.readdir(root).catch(() => [] as string[]);
  for (const n of names.slice(0, 50)) {
    const r = await tryName(root, n);
    if (r !== undefined) return r;
  }
  return process.platform === 'win32' || process.platform === 'darwin';
}

// ------------------------------------------------------------------ scanning

export interface ScanOptions {
  filter: PathFilter;
  caseInsensitive: boolean;
  skipHidden: boolean;
  symlinks: SyncOptions['symlinks'];
  checkpoint: Checkpoint;
  onEntry?: () => void;
}

export async function scanSide(root: string, o: ScanOptions): Promise<SideScan> {
  const s: SideScan = {
    root, entries: new Map(), dirRels: new Map([['', '']]), collisions: new Set(), unreadable: new Set(), holdsOutOfScope: new Set(), untouchable: new Set(),
    excluded: 0, symlinksSkipped: 0, special: 0, errors: [],
  };
  const markOut = (k: string) => {
    for (;;) {
      if (s.holdsOutOfScope.has(k)) return;
      s.holdsOutOfScope.add(k);
      if (k === '') return;
      k = parentKey(k);
    }
  };
  const seenDirs = new Set<string>();
  const rootSt = await fsp.stat(root);
  seenDirs.add(`${rootSt.dev}:${rootSt.ino}`);
  const stack: Array<{ rel: string; key: string; included: boolean }> = [{ rel: '', key: '', included: false }];
  let n = 0;
  while (stack.length) {
    await o.checkpoint();
    const dir = stack.pop()!;
    const abs = dir.rel ? path.join(root, ...dir.rel.split('/')) : root;
    let list: fs.Dirent[];
    try {
      list = await fsp.readdir(abs, { withFileTypes: true });
    } catch (err) {
      if (dir.rel === '') throw makeError('permission_denied', 'sync.scan', { message: 'The folder could not be read.', target: root, cause: (err as { code?: string }).code });
      s.unreadable.add(dir.key);
      markOut(dir.key);
      s.errors.push(`${abs}: ${(err as { code?: string }).code ?? 'unreadable'}`);
      continue;
    }
    list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of list) {
      if (++n % 256 === 0) await o.checkpoint();
      const name = d.name;
      const rel = dir.rel ? `${dir.rel}/${name}` : name;
      const key = dir.key ? `${dir.key}/${keyOf(name, o.caseInsensitive)}` : keyOf(name, o.caseInsensitive);
      if (name.startsWith(PART_PREFIX)) {
        markOut(dir.key);
        continue;
      }
      if (o.skipHidden && name.startsWith('.')) {
        s.excluded++;
        markOut(dir.key);
        continue;
      }
      const p = path.join(abs, name);
      let st: fs.Stats;
      try {
        st = await fsp.lstat(p);
      } catch (err) {
        s.unreadable.add(key);
        markOut(dir.key);
        s.errors.push(`${p}: ${(err as { code?: string }).code ?? 'unreadable'}`);
        continue;
      }
      const isDir = st.isDirectory();
      const verdict = o.filter.check(rel, name, isDir, dir.included);
      if (verdict === 'out') {
        s.excluded++;
        markOut(dir.key);
        continue;
      }
      let linkTarget: string | undefined;
      if (st.isSymbolicLink()) {
        if (o.symlinks === 'skip') {
          s.symlinksSkipped++;
          s.untouchable.add(key);
          markOut(dir.key);
          continue;
        }
        try {
          linkTarget = await fsp.readlink(p);
        } catch (err) {
          s.unreadable.add(key);
          markOut(dir.key);
          s.errors.push(`${p}: ${(err as { code?: string }).code ?? 'unreadable'}`);
          continue;
        }
      } else if (!isDir && !st.isFile()) {
        s.special++;
        s.untouchable.add(key);
        markOut(dir.key);
        continue;
      }
      if (s.entries.has(key) || s.dirRels.has(key)) {
        s.collisions.add(key);
        markOut(dir.key);
        continue;
      }
      if (isDir) {
        const id = `${st.dev}:${st.ino}`;
        if (seenDirs.has(id)) {
          // The same folder mounted twice inside the tree: walked once only.
          markOut(dir.key);
          continue;
        }
        seenDirs.add(id);
        s.dirRels.set(key, rel);
        stack.push({ rel, key, included: verdict === 'in' });
        if (verdict === 'pass') {
          // Only searched for included items; the folder itself is not synchronized.
          markOut(dir.key);
          continue;
        }
      }
      s.entries.set(key, { key, rel, name, kind: st.isSymbolicLink() ? 'symlink' : isDir ? 'directory' : 'file', size: st.isFile() ? st.size : 0, mtimeMs: st.mtimeMs, linkTarget });
      o.onEntry?.();
    }
  }
  return s;
}

/** Where an item lives (or would be created) on a side: existing folders keep that side's spelling. */
function relOn(scan: SideScan, key: string, srcRel: string): string {
  const e = scan.entries.get(key);
  if (e) return e.rel;
  const d = scan.dirRels.get(key);
  if (d !== undefined && d !== '') return d;
  const pk = parentKey(key);
  const name = baseName(srcRel);
  return pk === '' ? name : `${relOn(scan, pk, dirName(srcRel))}/${name}`;
}

async function realDir(p: string, which: string): Promise<string> {
  const st = await fsp.stat(p).catch(() => undefined);
  if (!st?.isDirectory()) throw makeError('not_a_directory', 'sync.plan', { message: `The ${which} folder does not exist or is not a folder.`, target: p });
  return fsp.realpath(p);
}

// ------------------------------------------------------------------ planning

export async function computePlan(input: PlanInput): Promise<PlanResult> {
  const { mode, options, checkpoint, signal, hashes } = input;
  const left = await realDir(input.left, 'left');
  const right = await realDir(input.right, 'right');
  if (isWithin(left, right) || isWithin(right, left)) {
    throw makeError('validation', 'sync.plan', { message: left === right ? 'Choose two different folders.' : 'One folder is inside the other. Choose two folders that do not contain each other.' });
  }
  const caseInsensitive = (await probeCaseInsensitive(left)) || (await probeCaseInsensitive(right));
  const filter = makeFilter(options.include, options.exclude, caseInsensitive);
  let scanned = 0;
  const scanOpts: ScanOptions = {
    filter, caseInsensitive, skipHidden: options.skipHidden, symlinks: options.symlinks, checkpoint,
    onEntry: () => {
      if (++scanned % 200 === 0) input.onProgress?.({ stage: 'scanning', done: scanned });
    },
  };
  const L = await scanSide(left, scanOpts);
  const R = await scanSide(right, scanOpts);
  input.onProgress?.({ stage: 'scanning', done: scanned });

  const notes: string[] = [];
  const tol = Math.max(1, options.mtimeToleranceMs);
  const close = (a: number, b: number) => Math.abs(a - b) <= tol;
  const baselineKeys = new Map<string, BaselineRow>();
  let badRows = 0;
  for (const row of input.baseline?.rows ?? []) {
    if (!isSafeRel(row.rel)) {
      badRows++;
      continue;
    }
    baselineKeys.set(keyOf(row.rel, caseInsensitive), row);
  }
  if (badRows) notes.push(`${badRows} stored entr${badRows === 1 ? 'y' : 'ies'} of the last synchronization had paths that are not allowed and were ignored.`);

  const absL = (e: ScanEntry) => path.join(left, ...e.rel.split('/'));
  const absR = (e: ScanEntry) => path.join(right, ...e.rel.split('/'));
  /** A file that cannot be read is recorded as unreadable (nothing is done with it) instead of failing the whole plan. */
  const hashOf = async (e: ScanEntry, side: SyncSide): Promise<string> => {
    const abs = side === 'left' ? absL(e) : absR(e);
    try {
      return await hashes.get(abs, e.size, e.mtimeMs, signal, checkpoint);
    } catch (err) {
      if (signal.aborted || (err as { shape?: { category?: string } }).shape?.category === 'cancelled') throw err;
      const scan = side === 'left' ? L : R;
      scan.unreadable.add(e.key);
      scan.errors.push(`${abs}: ${(err as { code?: string }).code ?? 'unreadable'}`);
      return `unreadable:${side}:${crypto.randomUUID()}`;
    }
  };

  /** Whether two present items have the same contents; `why` describes the difference. */
  const compare = async (l: ScanEntry, r: ScanEntry): Promise<{ same: boolean; why: string }> => {
    if (l.kind !== r.kind) return { same: false, why: 'different kinds' };
    if (l.kind === 'directory') return { same: true, why: '' };
    if (l.kind === 'symlink') return l.linkTarget === r.linkTarget ? { same: true, why: '' } : { same: false, why: 'the links point to different places' };
    if (l.size !== r.size) return { same: false, why: 'different sizes' };
    const timeSame = close(l.mtimeMs, r.mtimeMs);
    if (!options.verify) return timeSame ? { same: true, why: '' } : { same: false, why: 'different modification times' };
    const [a, b] = [await hashOf(l, 'left'), await hashOf(r, 'right')];
    if (a === b) return { same: true, why: '' };
    return { same: false, why: timeSame ? 'same size and time, different contents' : 'different contents' };
  };

  /** Two-way: whether a side changed since the baseline. */
  const changedSince = async (e: ScanEntry, b: BaselineRow, side: SyncSide): Promise<boolean> => {
    if (e.kind !== b.kind) return true;
    if (e.kind === 'directory') return false;
    if (e.kind === 'symlink') return e.linkTarget !== b.linkTarget;
    if (e.size !== b.size) return true;
    if (!close(e.mtimeMs, side === 'left' ? b.leftMtimeMs : b.rightMtimeMs)) return true;
    if (options.verify && b.sha256) return (await hashOf(e, side)) !== b.sha256;
    return false;
  };

  const actions: PlanAction[] = [];
  const inSync: InSyncItem[] = [];
  /** Keys whose descendants are not compared (conflicting kinds, case collisions). */
  const blocked = new Set<string>();
  let extraKept = 0;
  const twoWay = mode === 'two-way';

  const push = (a: Omit<PlanAction, 'id' | 'leftRel' | 'rightRel' | 'rel'> & { rel?: string }) => {
    const l = L.entries.get(a.key);
    const r = R.entries.get(a.key);
    const srcRel = l?.rel ?? r?.rel ?? a.rel ?? a.key;
    actions.push({ ...a, id: 0, rel: srcRel, leftRel: relOn(L, a.key, srcRel), rightRel: relOn(R, a.key, srcRel) } as PlanAction);
  };
  const bytesOf = (e?: ScanEntry) => (e?.kind === 'file' ? e.size : 0);
  const label = (kind: SyncItemKind) => (kind === 'directory' ? 'Folder' : kind === 'symlink' ? 'Link' : 'File');
  const conflict = (key: string, type: SyncConflictType, reason: string, l?: ScanEntry, r?: ScanEntry, choices: ConflictChoice[] = ['skip']) => {
    push({ key, kind: (l ?? r)!.kind, action: 'conflict', conflict: type, reason, bytes: Math.max(bytesOf(l), bytesOf(r)), left: l && info(l), right: r && info(r), choices });
  };

  for (const k of [...L.collisions, ...R.collisions]) {
    if (blocked.has(k)) continue;
    blocked.add(k);
    const l = L.entries.get(k);
    const r = R.entries.get(k);
    if (l || r) conflict(k, 'case', 'Two names here differ only in letter case, and one of the folders ignores case, so they cannot be matched. Rename one of them.', l, r);
  }

  for (const [mine, other] of [[L, R], [R, L]] as const) {
    for (const k of mine.untouchable) {
      const e = other.entries.get(k);
      if (!e || blocked.has(k)) continue;
      blocked.add(k);
      conflict(k, 'kind', 'The other folder has a link or a special file here, which is never followed, copied over or removed. Resolve this by hand.', other === L ? e : undefined, other === R ? e : undefined);
    }
  }

  const keys = [...new Set([...L.entries.keys(), ...R.entries.keys()])].sort();
  let done = 0;
  for (const k of keys) {
    if (++done % 500 === 0) {
      await checkpoint();
      input.onProgress?.({ stage: 'comparing', done, total: keys.length });
    }
    if (blocked.has(k)) continue;
    const l = L.entries.get(k);
    const r = R.entries.get(k);

    if (!twoWay) {
      if (l && !r) {
        push({ key: k, kind: l.kind, action: 'copy', to: 'right', reason: `${label(l.kind)} only in the source`, bytes: bytesOf(l), left: info(l) });
      } else if (!l && r) {
        if (mode === 'mirror') push({ key: k, kind: r.kind, action: 'delete', to: 'right', reason: 'Not in the source', bytes: bytesOf(r), right: info(r) });
        else extraKept++;
      } else if (l && r) {
        if (l.kind !== r.kind) {
          if (mode === 'mirror') {
            push({ key: k, kind: r.kind, action: 'delete', to: 'right', reason: `Replaced: the source has a ${l.kind === 'directory' ? 'folder' : l.kind === 'symlink' ? 'link' : 'file'} here`, bytes: bytesOf(r), right: info(r) });
            push({ key: k, kind: l.kind, action: 'copy', to: 'right', reason: `${label(l.kind)} replaces the ${r.kind === 'directory' ? 'folder' : r.kind === 'symlink' ? 'link' : 'file'} in the target`, bytes: bytesOf(l), left: info(l), replaces: true });
          } else {
            blocked.add(k);
            conflict(k, 'kind', 'A file on one side and a folder or link on the other. "Update" never removes anything, so resolve this by hand.', l, r);
          }
          continue;
        }
        const c = await compare(l, r);
        if (c.same) {
          inSync.push({ key: k, l, r });
          continue;
        }
        if (l.kind === 'file' && r.mtimeMs > l.mtimeMs + tol) {
          conflict(k, 'target-newer', `The copy in the target is newer than the source (${c.why})`, l, r, mode === 'update' ? ['left', 'both', 'skip'] : ['left', 'skip']);
        } else if (l.kind === 'file' && close(l.mtimeMs, r.mtimeMs)) {
          conflict(k, 'same-time', `Same modification time, ${c.why.replace(/^same size and time, /, '')}`, l, r, mode === 'update' ? ['left', 'both', 'skip'] : ['left', 'skip']);
        } else {
          push({ key: k, kind: l.kind, action: 'update', to: 'right', reason: l.kind === 'symlink' ? 'The link points somewhere else in the source' : `Newer in the source (${c.why})`, bytes: bytesOf(l), left: info(l), right: info(r) });
        }
      }
      continue;
    }

    // ---------------- two-way
    const b = baselineKeys.get(k);
    if (l && r) {
      if (l.kind !== r.kind) {
        blocked.add(k);
        conflict(k, 'kind', 'A file on one side and a folder or link on the other. Resolve this by hand.', l, r);
        continue;
      }
      if (!b) {
        const c = await compare(l, r);
        if (c.same) inSync.push({ key: k, l, r });
        else conflict(k, 'created-both', `On both sides with ${c.why}, and no earlier synchronization to tell which is newer`, l, r, l.kind === 'file' ? ['left', 'right', 'both', 'skip'] : ['left', 'right', 'skip']);
        continue;
      }
      const lc = await changedSince(l, b, 'left');
      const rc = await changedSince(r, b, 'right');
      if (!lc && !rc) {
        inSync.push({ key: k, l, r });
      } else if (lc && !rc) {
        push({ key: k, kind: l.kind, action: 'update', to: 'right', reason: 'Changed on the left', bytes: bytesOf(l), left: info(l), right: info(r) });
      } else if (!lc && rc) {
        push({ key: k, kind: r.kind, action: 'update', to: 'left', reason: 'Changed on the right', bytes: bytesOf(r), left: info(l), right: info(r) });
      } else {
        const c = await compare(l, r);
        if (c.same) inSync.push({ key: k, l, r });
        else conflict(k, 'changed-both', `Changed on both sides (${c.why})`, l, r, l.kind === 'file' ? ['left', 'right', 'both', 'skip'] : ['left', 'right', 'skip']);
      }
    } else if (l && !r) {
      if (!b) push({ key: k, kind: l.kind, action: 'copy', to: 'right', reason: `New on the left`, bytes: bytesOf(l), left: info(l) });
      else if (await changedSince(l, b, 'left')) conflict(k, 'deleted-changed', 'Deleted on the right but changed on the left', l, undefined, ['left', 'right', 'skip']);
      else push({ key: k, kind: l.kind, action: 'delete', to: 'left', reason: 'Deleted on the right', bytes: bytesOf(l), left: info(l) });
    } else if (!l && r) {
      if (!b) push({ key: k, kind: r.kind, action: 'copy', to: 'left', reason: `New on the right`, bytes: bytesOf(r), right: info(r) });
      else if (await changedSince(r, b, 'right')) conflict(k, 'deleted-changed', 'Deleted on the left but changed on the right', undefined, r, ['left', 'right', 'skip']);
      else push({ key: k, kind: r.kind, action: 'delete', to: 'right', reason: 'Deleted on the left', bytes: bytesOf(r), right: info(r) });
    }
  }
  if (twoWay && !input.baseline) notes.push('These two folders have not been synchronized two-way before: items missing on one side are copied to it, nothing is deleted, and items that differ are conflicts for you to decide.');

  // Nothing at or below an unreadable location is changed, and nothing below a blocked item.
  const unreadable = new Set([...L.unreadable, ...R.unreadable]);
  const underAny = (key: string, set: Set<string>, includeSelf: boolean): boolean => {
    if (includeSelf && set.has(key)) return true;
    for (let p = parentKey(key); ; p = parentKey(p)) {
      if (p !== '' && set.has(p)) return true;
      if (p === '') return false;
    }
  };
  let notCompared = 0;
  let kept = actions.filter((a) => {
    const drop = underAny(a.key, unreadable, true) || underAny(a.key, blocked, false);
    if (drop) notCompared++;
    return !drop;
  });

  // Folders deleted as a whole: only when everything inside is deleted too and nothing inside is out of scope.
  for (const side of ['left', 'right'] as const) {
    const scan = side === 'left' ? L : R;
    const dirDeletes = new Map(kept.filter((a) => a.action === 'delete' && a.to === side && a.kind === 'directory').map((a) => [a.key, a]));
    if (!dirDeletes.size) continue;
    const deleted = new Set(kept.filter((a) => a.action === 'delete' && a.to === side).map((a) => a.key));
    const total = new Map<string, { items: number; del: number; bytes: number }>();
    for (const e of scan.entries.values()) {
      for (let p = parentKey(e.key); ; p = parentKey(p)) {
        if (dirDeletes.has(p)) {
          const t = total.get(p) ?? { items: 0, del: 0, bytes: 0 };
          t.items++;
          if (deleted.has(e.key)) t.del++;
          t.bytes += e.kind === 'file' ? e.size : 0;
          total.set(p, t);
        }
        if (p === '') break;
      }
    }
    const whole = new Set<string>();
    for (const [k] of dirDeletes) {
      const t = total.get(k) ?? { items: 0, del: 0, bytes: 0 };
      if (!scan.holdsOutOfScope.has(k) && t.items === t.del) whole.add(k);
    }
    kept = kept.filter((a) => {
      if (a.action !== 'delete' || a.to !== side) return true;
      if (underAny(a.key, whole, false)) return false; // removed with a folder above it
      if (a.kind === 'directory') {
        if (!whole.has(a.key)) return false; // the folder stays: something inside is kept
        const t = total.get(a.key);
        a.items = t?.items ?? 0;
        a.bytes = t?.bytes ?? 0;
      }
      return true;
    });
  }
  // Mirror: a replacement whose old folder cannot be removed whole becomes a conflict.
  const deletedNow = new Set(kept.filter((a) => a.action === 'delete').map((a) => `${a.to}:${a.key}`));
  const newlyBlocked = new Set<string>();
  kept = kept.map((a) => {
    if (!a.replaces || deletedNow.has(`right:${a.key}`)) return a;
    newlyBlocked.add(a.key);
    const r = R.entries.get(a.key);
    return { ...a, action: 'conflict' as SyncActionKind, to: undefined, replaces: undefined, conflict: 'kind' as SyncConflictType, choices: ['skip'] as ConflictChoice[], right: r && info(r), reason: 'The source has a file here, but the folder in the target holds items that are excluded or cannot be removed. Resolve this by hand.' };
  });
  if (newlyBlocked.size) {
    kept = kept.filter((a) => {
      const drop = underAny(a.key, newlyBlocked, false);
      if (drop) notCompared++;
      return !drop;
    });
  }

  // Conflicts first (they need decisions), then by path.
  const rank: Record<SyncActionKind, number> = { conflict: 0, delete: 1, copy: 2, update: 3 };
  kept.sort((a, b) => rank[a.action] - rank[b.action] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  kept.forEach((a, i) => (a.id = i));

  if (caseInsensitive) notes.push('Names are matched ignoring letter case because at least one of the folders is on a file system that ignores case. Renames that only change letter case are not synchronized.');
  if (L.symlinksSkipped + R.symlinksSkipped) notes.push(`${L.symlinksSkipped + R.symlinksSkipped} symbolic link(s) were left alone (links are never followed; choose “Copy links as links” to synchronize the links themselves).`);
  if (L.errors.length + R.errors.length) notes.push(`${L.errors.length + R.errors.length} location(s) could not be read; nothing at or below them is changed.`);

  return {
    left, right, mode, options, caseInsensitive, actions: kept, inSync, leftScan: L, rightScan: R, baselineKeys,
    extraKept, notCompared, notes,
  };
}
