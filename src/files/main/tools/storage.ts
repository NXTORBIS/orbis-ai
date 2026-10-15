import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { TYPE_GROUPS } from '../search/query';
import { extOf } from '../fs/FileSystemService';
import { makeError } from '../../shared/errors';
import { compileGlob, type CompiledGlob } from '../../shared/glob';
import type { JobGate } from '../jobs/PauseGate';

/**
 * Storage analysis: one read-only walk of a folder (symbolic links are never
 * followed) that produces totals, the treemap and every list the Storage view
 * shows. The walk is a background job: it waits at the PauseGate between
 * entries, stops on cancel, and stops at a limit of entries for huge trees.
 * Stopped or limited scans are marked partial.
 */

export function categoryOf(ext: string, kind: string): string {
  if (kind === 'directory') return 'folder';
  for (const [cat, exts] of Object.entries(TYPE_GROUPS)) if (cat !== 'text' && exts.includes(ext)) return cat;
  if (TYPE_GROUPS.text!.includes(ext)) return 'text';
  return 'other';
}

export interface TreeNode { name: string; path: string; bytes: number; files: number; children?: TreeNode[]; truncated?: number }

export type JunkCategory = 'temporary' | 'system' | 'cache' | 'backup';

/**
 * Well-known names of files and folders that are usually safe to remove. They
 * are shown as suggestions only; the user selects what goes to the Trash.
 */
export const JUNK_PATTERNS: Record<JunkCategory, { label: string; files?: string[]; dirs?: string[]; note: string }> = {
  temporary: {
    label: 'Temporary and incomplete files',
    files: ['*.tmp', '*.temp', '~$*', '.~lock.*#', '*.swp', '*.swo', '*.part', '*.partial', '*.crdownload'],
    note: 'Left behind by editors, office programs and interrupted downloads. A program that is still running may be using some of them.',
  },
  system: {
    label: 'Folder view files',
    files: ['.DS_Store', 'Thumbs.db', 'ehthumbs.db'],
    note: 'Created by macOS Finder and Windows Explorer to remember icon positions and thumbnails; they are recreated when needed.',
  },
  cache: {
    label: 'Build and tool caches',
    dirs: ['**/node_modules/.cache', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.parcel-cache', '.sass-cache', '**/.next/cache'],
    note: 'Caches that development tools rebuild automatically. The next build or test run may be slower.',
  },
  backup: {
    label: 'Backup copies',
    files: ['*.bak', '*~'],
    note: 'Automatic backup copies written by editors. Check that you do not need the older version.',
  },
};

export interface StorageOptions {
  /** A file is "old" when it was not modified for this many months (default 12). */
  oldMonths?: number;
  /** Stop after this many entries (files, folders and links) — protects memory on huge trees. */
  maxEntries?: number;
}

export interface FileRow { path: string; bytes: number; modifiedMs: number }
export interface JunkItem { path: string; bytes: number; kind: 'file' | 'directory'; category: JunkCategory; pattern: string; modifiedMs: number }

export interface StorageReport {
  root: string;
  complete: boolean;
  cancelled: boolean;
  /** The scan stopped at `maxEntries`. */
  limitReached: boolean;
  maxEntries: number;
  entries: number;
  bytes: number;
  files: number;
  directories: number;
  symlinksSkipped: number;
  unreadable: number;
  byCategory: Array<{ category: string; bytes: number; files: number }>;
  /** Files by extension ('' = no extension), largest total first. */
  byExtension: Array<{ ext: string; bytes: number; files: number }>;
  /** Extensions beyond the listed ones (their files are in the totals). */
  extensionsTruncated: number;
  largestFiles: FileRow[];
  oldMonths: number;
  /** Old files: the largest and the oldest (up to 200 each, merged). */
  oldFiles: FileRow[];
  oldTotals: { files: number; bytes: number };
  /** Archive files found (largest first) — the archive inventory. */
  archives: FileRow[];
  /** Folders by total size, largest first (excluding the root). */
  largestFolders: Array<{ path: string; bytes: number; files: number }>;
  /** Folders that contain nothing but (possibly nested) empty folders; only the topmost is listed. */
  emptyDirs: Array<{ path: string; nested: number }>;
  /** Symbolic links whose target does not exist (or that loop). */
  brokenLinks: Array<{ path: string; target: string; reason: 'missing' | 'loop' }>;
  /** Temporary/cache/backup candidates by well-known names — suggestions only. */
  junk: JunkItem[];
  junkTotals: Record<JunkCategory, { items: number; bytes: number }>;
  tree: TreeNode;
  volume?: { totalBytes: number; freeBytes: number };
  scannedMs: number;
}

export const STORAGE_TOP_N = 100;
const LIST_MAX = 200;
const COLLECT_MAX = 5000;
const EXT_MAX = 20000;
const TREE_CHILDREN = 60;
export const DEFAULT_MAX_ENTRIES = 2_000_000;
const MONTH_MS = 30.436875 * 86400000;

/** Bounded "top N" list, largest key first. */
function pushTop<T>(list: T[], item: T, n: number, key: (t: T) => number): void {
  if (list.length < n) {
    list.push(item);
    if (list.length === n) list.sort((a, b) => key(b) - key(a));
    return;
  }
  if (key(item) <= key(list[n - 1]!)) return;
  list[n - 1] = item;
  list.sort((a, b) => key(b) - key(a));
}

interface JunkMatcher { category: JunkCategory; pattern: string; glob: CompiledGlob; dir: boolean }

const JUNK_MATCHERS: JunkMatcher[] = Object.entries(JUNK_PATTERNS).flatMap(([category, p]) => [
  ...(p.files ?? []).map((pattern) => ({ category: category as JunkCategory, pattern, glob: compileGlob(pattern, { caseSensitive: false }), dir: false })),
  ...(p.dirs ?? []).map((pattern) => ({ category: category as JunkCategory, pattern, glob: compileGlob(pattern, { caseSensitive: true }), dir: true })),
]);

function junkMatch(rel: string, name: string, dir: boolean): JunkMatcher | undefined {
  for (const m of JUNK_MATCHERS) if (m.dir === dir && m.glob.test(rel, name)) return m;
  return undefined;
}

export async function scanStorage(root: string, signal: AbortSignal, onProgress: (p: { files: number; bytes: number; entries: number; current: string }) => void, gate?: JobGate, opts: StorageOptions = {}): Promise<StorageReport> {
  const st = await fsp.stat(root).catch(() => undefined);
  if (!st?.isDirectory()) throw makeError('not_a_directory', 'tool.storage', { target: root });
  const oldMonths = Math.max(1, Math.min(600, Math.round(opts.oldMonths ?? 12)));
  const maxEntries = Math.max(1, opts.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const report: StorageReport = {
    root, complete: false, cancelled: false, limitReached: false, maxEntries, entries: 0, bytes: 0, files: 0, directories: 0, symlinksSkipped: 0, unreadable: 0,
    byCategory: [], byExtension: [], extensionsTruncated: 0, largestFiles: [], oldMonths, oldFiles: [], oldTotals: { files: 0, bytes: 0 }, archives: [], largestFolders: [],
    emptyDirs: [], brokenLinks: [], junk: [], junkTotals: { temporary: { items: 0, bytes: 0 }, system: { items: 0, bytes: 0 }, cache: { items: 0, bytes: 0 }, backup: { items: 0, bytes: 0 } },
    tree: { name: path.basename(root) || root, path: root, bytes: 0, files: 0 }, scannedMs: Date.now(),
  };
  const cats = new Map<string, { bytes: number; files: number }>();
  const exts = new Map<string, { bytes: number; files: number }>();
  const oldBySize: FileRow[] = [];
  const oldByAge: FileRow[] = [];
  const seen = new Set<string>([`${st.dev}:${st.ino}`]);
  const now = Date.now();
  const oldBefore = now - oldMonths * MONTH_MS;
  let last = 0;
  const stopped = () => signal.aborted || report.limitReached;
  const countEntry = () => {
    report.entries++;
    if (report.entries >= maxEntries) report.limitReached = true;
  };
  const addJunk = (item: JunkItem) => {
    report.junkTotals[item.category].items++;
    report.junkTotals[item.category].bytes += item.bytes;
    if (report.junk.length < COLLECT_MAX) report.junk.push(item);
  };

  /**
   * Depth-first, post-order so folder totals roll up. Returns the number of
   * nested folders when this folder is effectively empty (contains only empty
   * folders), or null when it holds anything else or was not fully read.
   */
  async function visit(dir: string, rel: string, node: TreeNode, depth: number, inJunk: boolean): Promise<number | null> {
    if (stopped()) return null;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      report.unreadable++;
      return null;
    }
    const children: TreeNode[] = [];
    let empty = true;
    let nested = 0;
    const emptyChildren: Array<{ path: string; nested: number }> = [];
    for (const d of entries) {
      if (gate?.isPaused) await gate.wait();
      if (stopped()) return null;
      countEntry();
      const p = path.join(dir, d.name);
      const r = rel ? `${rel}/${d.name}` : d.name;
      let s: fs.Stats;
      try {
        s = await fsp.lstat(p);
      } catch {
        report.unreadable++;
        empty = false;
        continue;
      }
      if (s.isSymbolicLink()) {
        empty = false;
        report.symlinksSkipped++;
        try {
          await fsp.stat(p);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if ((code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') && report.brokenLinks.length < COLLECT_MAX) {
            report.brokenLinks.push({ path: p, target: await fsp.readlink(p).catch(() => '?'), reason: code === 'ELOOP' ? 'loop' : 'missing' });
          }
        }
        continue;
      }
      if (s.isDirectory()) {
        const key = `${s.dev}:${s.ino}`;
        if (seen.has(key)) {
          empty = false;
          continue;
        }
        seen.add(key);
        report.directories++;
        const child: TreeNode = { name: d.name, path: p, bytes: 0, files: 0 };
        const jm = inJunk ? undefined : junkMatch(r, d.name, true);
        const childEmpty = await visit(p, r, child, depth + 1, inJunk || !!jm);
        node.bytes += child.bytes;
        node.files += child.files;
        children.push(child);
        pushTop(report.largestFolders, { path: p, bytes: child.bytes, files: child.files }, STORAGE_TOP_N, (x) => x.bytes);
        if (jm && !stopped()) addJunk({ path: p, bytes: child.bytes, kind: 'directory', category: jm.category, pattern: jm.pattern, modifiedMs: s.mtimeMs });
        if (childEmpty === null) empty = false;
        else {
          nested += childEmpty + 1;
          emptyChildren.push({ path: p, nested: childEmpty });
        }
        continue;
      }
      empty = false;
      if (!s.isFile()) continue;
      report.files++;
      report.bytes += s.size;
      node.bytes += s.size;
      node.files++;
      const ext = extOf(d.name);
      const cat = categoryOf(ext, 'file');
      const c = cats.get(cat) ?? { bytes: 0, files: 0 };
      c.bytes += s.size;
      c.files++;
      cats.set(cat, c);
      // Distinct extensions are capped so a tree of random names cannot grow the table without bound.
      const ek = exts.has(ext) || exts.size < EXT_MAX ? ext : '\0other';
      const e = exts.get(ek) ?? { bytes: 0, files: 0 };
      e.bytes += s.size;
      e.files++;
      exts.set(ek, e);
      const row: FileRow = { path: p, bytes: s.size, modifiedMs: s.mtimeMs };
      pushTop(report.largestFiles, row, STORAGE_TOP_N, (x) => x.bytes);
      if (s.mtimeMs < oldBefore) {
        report.oldTotals.files++;
        report.oldTotals.bytes += s.size;
        pushTop(oldBySize, row, LIST_MAX, (x) => x.bytes);
        pushTop(oldByAge, row, LIST_MAX, (x) => -x.modifiedMs);
      }
      if (cat === 'archive') pushTop(report.archives, row, LIST_MAX, (x) => x.bytes);
      if (!inJunk) {
        const jm = junkMatch(r, d.name, false);
        if (jm) addJunk({ ...row, kind: 'file', category: jm.category, pattern: jm.pattern });
      }
      children.push({ name: d.name, path: p, bytes: s.size, files: 1 });
      const t = Date.now();
      if (t - last > 200) {
        last = t;
        onProgress({ files: report.files, bytes: report.bytes, entries: report.entries, current: dir });
      }
    }
    children.sort((a, b) => b.bytes - a.bytes);
    // Keep the tree bounded for the treemap: deeper levels and small items are summarised.
    if (depth < 6) {
      node.children = children.slice(0, TREE_CHILDREN);
      if (children.length > TREE_CHILDREN) node.truncated = children.length - TREE_CHILDREN;
    }
    if (empty && depth > 0) return nested;
    // This folder holds something (or is the scanned folder): its empty subfolders are the topmost empty ones.
    for (const ec of emptyChildren) if (report.emptyDirs.length < COLLECT_MAX) report.emptyDirs.push(ec);
    return null;
  }

  await visit(root, '', report.tree, 0, false);
  report.byCategory = [...cats.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.bytes - a.bytes);
  const extList = [...exts.entries()].map(([ext, v]) => ({ ext: ext === '\0other' ? '(other)' : ext, ...v })).sort((a, b) => b.bytes - a.bytes || b.files - a.files);
  report.byExtension = extList.slice(0, 500);
  report.extensionsTruncated = Math.max(0, extList.length - 500);
  report.largestFiles.sort((a, b) => b.bytes - a.bytes);
  const oldMap = new Map([...oldBySize, ...oldByAge].map((f) => [f.path, f]));
  report.oldFiles = [...oldMap.values()].sort((a, b) => b.bytes - a.bytes);
  report.archives.sort((a, b) => b.bytes - a.bytes);
  report.largestFolders.sort((a, b) => b.bytes - a.bytes);
  report.junk.sort((a, b) => b.bytes - a.bytes);
  report.emptyDirs.sort((a, b) => (a.path < b.path ? -1 : 1));
  try {
    const sf = await fsp.statfs(root);
    report.volume = { totalBytes: sf.blocks * sf.bsize, freeBytes: sf.bavail * sf.bsize };
  } catch {
    /* unavailable */
  }
  report.cancelled = signal.aborted;
  report.complete = !signal.aborted && !report.limitReached && report.unreadable === 0;
  // Lists built from a partial walk would claim too much (e.g. a folder looks empty because it was not finished).
  if (!report.complete && (signal.aborted || report.limitReached)) report.emptyDirs = [];
  return report;
}
