import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { diffLines } from 'diff';
import { extOf, looksBinary } from '../fs/FileSystemService';
import { makeError } from '../../shared/errors';
import { parseCsv } from '../../shared/csv';
import type { JobGate } from '../jobs/PauseGate';

/**
 * Folder comparison and text/structured diffs. Storage analysis lives in
 * storage.ts and duplicate detection in duplicates.ts (re-exported here). All
 * results come from real scans; partial scans are marked partial and never
 * presented as complete.
 */

export { scanStorage, categoryOf, JUNK_PATTERNS, type StorageReport, type StorageOptions, type TreeNode, type JunkCategory } from './storage';

// ---------------------------------------------------------------- hashing helpers
export async function sha256(p: string, signal?: AbortSignal): Promise<string> {
  const h = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const s = fs.createReadStream(p, { highWaterMark: 1024 * 1024, signal });
    s.on('data', (c) => h.update(c as Buffer));
    s.on('end', resolve);
    s.on('error', reject);
  });
  return h.digest('hex');
}

export { findDuplicates, type DuplicateOptions, type DuplicateReport } from './duplicates';
export type { DuplicateGroup } from '../../shared/dedupe';

// ---------------------------------------------------------------- directory comparison
export interface CompareEntry { rel: string; kind: 'file' | 'directory' | 'symlink' | 'other'; leftSize?: number; rightSize?: number; leftMtime?: number; rightMtime?: number }
export interface CompareReport {
  left: string; right: string; verifyContent: boolean;
  onlyLeft: CompareEntry[]; onlyRight: CompareEntry[]; identical: CompareEntry[]; different: Array<CompareEntry & { reason: string }>;
  probablySame: CompareEntry[]; renamed: Array<{ left: string; right: string; size: number }>; errors: string[]; complete: boolean; cancelled: boolean;
}

async function snapshotTree(root: string, signal: AbortSignal, errors: string[], gate?: JobGate): Promise<Map<string, CompareEntry & { abs: string }>> {
  const out = new Map<string, CompareEntry & { abs: string }>();
  const stack = [''];
  while (stack.length) {
    if (gate?.isPaused) await gate.wait();
    if (signal.aborted) break;
    const rel = stack.pop()!;
    const abs = path.join(root, rel);
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(abs, { withFileTypes: true });
    } catch (err) {
      errors.push(`${abs}: ${(err as { code?: string }).code ?? 'unreadable'}`);
      continue;
    }
    for (const d of entries) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      const p = path.join(abs, d.name);
      try {
        const s = await fsp.lstat(p);
        const kind = s.isSymbolicLink() ? 'symlink' : s.isDirectory() ? 'directory' : s.isFile() ? 'file' : 'other';
        out.set(r, { rel: r, kind, abs: p, leftSize: kind === 'file' ? s.size : undefined, leftMtime: s.mtimeMs });
        if (kind === 'directory') stack.push(r);
      } catch (err) {
        errors.push(`${p}: ${(err as { code?: string }).code ?? 'unreadable'}`);
      }
    }
  }
  return out;
}

export async function compareDirectories(left: string, right: string, verifyContent: boolean, signal: AbortSignal, gate?: JobGate): Promise<CompareReport> {
  const errors: string[] = [];
  const [L, R] = await Promise.all([snapshotTree(left, signal, errors, gate), snapshotTree(right, signal, errors, gate)]);
  const report: CompareReport = { left, right, verifyContent, onlyLeft: [], onlyRight: [], identical: [], different: [], probablySame: [], renamed: [], errors, complete: false, cancelled: false };
  for (const [rel, l] of L) {
    if (gate?.isPaused) await gate.wait();
    if (signal.aborted) break;
    const r = R.get(rel);
    if (!r) {
      report.onlyLeft.push({ rel, kind: l.kind, leftSize: l.leftSize, leftMtime: l.leftMtime });
      continue;
    }
    const entry: CompareEntry = { rel, kind: l.kind, leftSize: l.leftSize, rightSize: r.leftSize, leftMtime: l.leftMtime, rightMtime: r.leftMtime };
    if (l.kind !== r.kind) {
      report.different.push({ ...entry, reason: `${l.kind} on the left, ${r.kind} on the right` });
      continue;
    }
    if (l.kind !== 'file') {
      if (l.kind === 'symlink') {
        const [a, b] = await Promise.all([fsp.readlink(l.abs).catch(() => ''), fsp.readlink(r.abs).catch(() => '')]);
        if (a === b) report.identical.push(entry);
        else report.different.push({ ...entry, reason: 'links point to different targets' });
      }
      continue;
    }
    if (l.leftSize !== r.leftSize) {
      report.different.push({ ...entry, reason: 'different sizes' });
      continue;
    }
    if (verifyContent) {
      try {
        const [a, b] = await Promise.all([sha256(l.abs, signal), sha256(r.abs, signal)]);
        if (a === b) report.identical.push(entry);
        else report.different.push({ ...entry, reason: 'same size, different content' });
      } catch (err) {
        if (!signal.aborted) errors.push(`${rel}: ${(err as Error).message}`);
      }
    } else if (Math.abs((l.leftMtime ?? 0) - (r.leftMtime ?? 0)) < 2000) {
      report.probablySame.push(entry);
    } else {
      report.different.push({ ...entry, reason: 'same size, different modification time (content not verified)' });
    }
  }
  for (const [rel, r] of R) if (!L.has(rel)) report.onlyRight.push({ rel, kind: r.kind, rightSize: r.leftSize, rightMtime: r.leftMtime });
  // Possible renames: identical content present only on one side each.
  if (verifyContent && !signal.aborted) {
    const leftFiles = report.onlyLeft.filter((e) => e.kind === 'file');
    const rightBySize = new Map<number, CompareEntry[]>();
    for (const e of report.onlyRight) if (e.kind === 'file') rightBySize.set(e.rightSize!, [...(rightBySize.get(e.rightSize!) ?? []), e]);
    for (const l of leftFiles) {
      if (gate?.isPaused) await gate.wait();
      if (signal.aborted) break;
      const cands = rightBySize.get(l.leftSize!) ?? [];
      if (!cands.length) continue;
      const lh = await sha256(path.join(left, l.rel)).catch(() => undefined);
      for (const c of cands) {
        if (lh && lh === (await sha256(path.join(right, c.rel)).catch(() => undefined))) {
          report.renamed.push({ left: l.rel, right: c.rel, size: l.leftSize! });
          break;
        }
      }
    }
  }
  report.cancelled = signal.aborted;
  report.complete = !signal.aborted && errors.length === 0;
  return report;
}

// ---------------------------------------------------------------- text and structured diff
const DIFF_MAX = 5 * 1024 * 1024;

async function readForDiff(p: string): Promise<string> {
  const st = await fsp.stat(p);
  if (!st.isFile()) throw makeError('is_a_directory', 'tool.diff', { target: p });
  if (st.size > DIFF_MAX) throw makeError('unsupported', 'tool.diff', { message: 'Files larger than 5 MB are compared by checksum only.', target: p });
  const buf = await fsp.readFile(p);
  if (looksBinary(buf)) throw makeError('unsupported', 'tool.diff', { message: 'Binary files are compared by size and checksum, not as text.', target: p });
  return buf.toString('utf8');
}

export interface TextDiff { hunks: Array<{ kind: 'same' | 'added' | 'removed'; lines: string[] }>; added: number; removed: number; identical: boolean; leftHash: string; rightHash: string }

export async function diffText(left: string, right: string): Promise<TextDiff> {
  const [a, b] = await Promise.all([readForDiff(left), readForDiff(right)]);
  return diffStrings(a, b);
}

/** Line diff of two strings. */
export function diffStrings(a: string, b: string): TextDiff {
  const parts = diffLines(a, b);
  let added = 0;
  let removed = 0;
  const hunks = parts.map((p) => {
    const lines = p.value.replace(/\n$/, '').split('\n');
    if (p.added) added += lines.length;
    if (p.removed) removed += lines.length;
    return { kind: (p.added ? 'added' : p.removed ? 'removed' : 'same') as 'added' | 'removed' | 'same', lines };
  });
  return {
    hunks, added, removed, identical: a === b,
    leftHash: crypto.createHash('sha256').update(a).digest('hex'),
    rightHash: crypto.createHash('sha256').update(b).digest('hex'),
  };
}

export interface StructuredDiff {
  format: 'json' | 'csv';
  formattingOnly: boolean;
  changes: Array<{ path: string; kind: 'added' | 'removed' | 'changed'; left?: string; right?: string }>;
  truncated: boolean;
}

function short(v: unknown): string {
  const s = JSON.stringify(v);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

function jsonDiff(a: unknown, b: unknown, at: string, out: StructuredDiff['changes'], max: number): void {
  if (out.length >= max) return;
  if (Object.is(a, b)) return;
  const isObj = (v: unknown) => v !== null && typeof v === 'object';
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (i >= a.length) out.push({ path: `${at}[${i}]`, kind: 'added', right: short(b[i]) });
      else if (i >= b.length) out.push({ path: `${at}[${i}]`, kind: 'removed', left: short(a[i]) });
      else jsonDiff(a[i], b[i], `${at}[${i}]`, out, max);
    }
    return;
  }
  if (isObj(a) && isObj(b) && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    for (const k of ka) {
      const p = at ? `${at}.${k}` : k;
      if (!(k in (b as object))) out.push({ path: p, kind: 'removed', left: short((a as Record<string, unknown>)[k]) });
      else jsonDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], p, out, max);
    }
    for (const k of kb) if (!(k in (a as object))) out.push({ path: at ? `${at}.${k}` : k, kind: 'added', right: short((b as Record<string, unknown>)[k]) });
    return;
  }
  out.push({ path: at || '(root)', kind: 'changed', left: short(a), right: short(b) });
}

export { parseCsv };

export async function diffStructured(left: string, right: string): Promise<StructuredDiff> {
  const [a, b] = await Promise.all([readForDiff(left), readForDiff(right)]);
  const ext = extOf(path.basename(left));
  const max = 5000;
  const changes: StructuredDiff['changes'] = [];
  if (ext === 'json' || ext === 'geojson') {
    let ja: unknown;
    let jb: unknown;
    try {
      ja = JSON.parse(a);
      jb = JSON.parse(b);
    } catch (err) {
      throw makeError('validation', 'tool.diffStructured', { message: `Could not parse JSON: ${(err as Error).message}` });
    }
    jsonDiff(ja, jb, '', changes, max);
    return { format: 'json', formattingOnly: changes.length === 0 && a !== b, changes, truncated: changes.length >= max };
  }
  if (ext === 'csv') {
    const ra = parseCsv(a);
    const rb = parseCsv(b);
    const header = ra[0] ?? [];
    const n = Math.max(ra.length, rb.length);
    for (let i = 0; i < n && changes.length < max; i++) {
      const x = ra[i];
      const y = rb[i];
      if (!x) changes.push({ path: `row ${i + 1}`, kind: 'added', right: y!.join(',') });
      else if (!y) changes.push({ path: `row ${i + 1}`, kind: 'removed', left: x.join(',') });
      else {
        const m = Math.max(x.length, y.length);
        for (let j = 0; j < m; j++) {
          if ((x[j] ?? '') !== (y[j] ?? '')) changes.push({ path: `row ${i + 1}, ${i === 0 ? `column ${j + 1}` : (header[j] ?? `column ${j + 1}`)}`, kind: 'changed', left: x[j] ?? '', right: y[j] ?? '' });
        }
      }
    }
    return { format: 'csv', formattingOnly: changes.length === 0 && a !== b, changes, truncated: changes.length >= max };
  }
  throw makeError('unsupported', 'tool.diffStructured', { message: 'Structured comparison supports JSON and CSV files.' });
}
