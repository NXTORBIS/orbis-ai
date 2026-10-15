import fsp from 'node:fs/promises';
import path from 'node:path';
import { structuredPatch } from 'diff';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import {
  applyReplacements,
  buildMatcher,
  findMatches,
  FIND_MAX_FILE_BYTES,
  FIND_MAX_MATCHES_PER_FILE,
  FIND_MAX_MATCHES_TOTAL,
  lineOf,
  lineStarts,
  ReplaceParamsSchema,
  type DiffLine,
  type FileMatches,
  type FindQuery,
  type FindReport,
  type FindRequest,
  type MatchInfo,
  type ReplaceFile,
  type ReplacePreview,
} from '../../shared/findReplace';
import { compileGlobs, matchesAny } from '../../shared/glob';
import type { OperationRecord, OperationRequest } from '../../shared/operations';
import type { ExternalRunner } from '../ops/OperationManager';
import type { JobGate } from '../jobs/PauseGate';
import { bomBytes, decodeText, detectText, encodeText } from './textCodec';
import { PART_PREFIX, replaceFileAtomic, sha256Of, type SnapshotUndoItem } from './docFiles';

/**
 * Find & replace in files. The search is a pausable background job that reads
 * each candidate file once (text only: binary files and files over 10 MB are
 * skipped and counted). Replacing is a 'find-replace' operation: each file must
 * still have the SHA-256 it had in the search, is snapshotted, rewritten in its
 * own encoding through a temporary file and verified; undo restores the snapshots.
 */

interface Decoded { text: string; encoding: FileMatches['encoding']; bom: boolean }

function decodeFile(bytes: Buffer): Decoded | 'binary' {
  const d = detectText(bytes);
  if (d.binary) return 'binary';
  // Every decoding here is byte-exact, so untouched text is written back as the same bytes.
  return { text: decodeText(bytes.subarray(d.bom), d.encoding), encoding: d.encoding, bom: d.bom > 0 };
}

const LINE_CONTEXT = 140;

function matchInfo(text: string, starts: number[], i: number, m: { index: number; text: string; captures: Array<string | undefined>; groups?: Record<string, string | undefined> }): MatchInfo {
  const line = lineOf(starts, m.index);
  const ls = starts[line]!;
  let le = line + 1 < starts.length ? starts[line + 1]! : text.length;
  while (le > ls && (text[le - 1] === '\n' || text[le - 1] === '\r')) le--;
  const mEnd = Math.min(m.index + m.text.length, le);
  const from = Math.max(ls, m.index - LINE_CONTEXT);
  const to = Math.min(le, Math.max(mEnd, m.index) + LINE_CONTEXT);
  const pre = from > ls ? '…' : '';
  const lineText = pre + text.slice(from, to) + (to < le ? '…' : '');
  const long = m.text.length > 2000;
  return {
    i,
    line: line + 1,
    column: m.index - ls + 1,
    text: long ? `${m.text.slice(0, 2000)}…` : m.text,
    lineText,
    start: pre.length + (m.index - from),
    end: pre.length + (mEnd - from),
    multiline: /[\r\n]/.test(m.text) || undefined,
    // Captures let the UI show each replacement inline; very long ones are left to the diff preview.
    captures: long || m.captures.reduce((n, c) => n + (c?.length ?? 0), 0) > 4000 ? [] : m.captures,
    groups: long ? undefined : m.groups,
  };
}

/** Search a folder's text files. Never follows links; honours include/exclude patterns and "skip hidden". */
export async function searchInFiles(req: FindRequest, signal: AbortSignal, onProgress: (p: { files: number; matches: number; current?: string }) => void, gate?: JobGate): Promise<FindReport> {
  const m = buildMatcher(req.query);
  if (!m.ok) throw makeError('validation', 'find.search', { message: m.error });
  const inc = compileGlobs(req.include);
  const exc = compileGlobs(req.exclude);
  const notes = [...inc.errors, ...exc.errors].map((e) => `Pattern ignored: ${e}`);
  const root = path.resolve(req.root);
  const rootSt = await fsp.stat(root).catch((err) => {
    throw new OrbisError(toOrbisError(err, 'find.search', root, 'no'));
  });
  if (!rootSt.isDirectory()) throw makeError('not_a_directory', 'find.search', { target: root, message: 'Choose a folder to search in.' });
  const report: FindReport = { root, files: [], totalMatches: 0, filesSearched: 0, skipped: { binary: 0, tooLarge: 0, unreadable: 0, excluded: 0, links: 0 }, partial: false, limitReached: false, notes };
  const stack: string[] = [''];
  let lastEmit = 0;
  outer: while (stack.length) {
    const rel = stack.pop()!;
    const dir = path.join(root, rel);
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      report.skipped.unreadable++;
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)); // files in name order; folders pushed so they pop in name order
    const subdirs: string[] = [];
    for (const e of entries) {
      if (gate?.isPaused) await gate.wait();
      if (signal.aborted) {
        report.partial = true;
        break outer;
      }
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.name.startsWith(PART_PREFIX)) continue;
      if (req.skipHidden && e.name.startsWith('.')) {
        report.skipped.excluded++;
        continue;
      }
      if (matchesAny(exc.globs, r, e.name)) {
        report.skipped.excluded++;
        continue;
      }
      if (e.isSymbolicLink()) {
        report.skipped.links++;
        continue;
      }
      if (e.isDirectory()) {
        subdirs.push(r);
        continue;
      }
      if (!e.isFile()) continue;
      if (inc.globs.length && !matchesAny(inc.globs, r, e.name)) {
        report.skipped.excluded++;
        continue;
      }
      const abs = path.join(root, r);
      try {
        const st = await fsp.lstat(abs);
        if (!st.isFile()) continue;
        if (st.size > FIND_MAX_FILE_BYTES) {
          report.skipped.tooLarge++;
          continue;
        }
        const bytes = await fsp.readFile(abs);
        const dec = decodeFile(bytes);
        report.filesSearched++;
        if (dec === 'binary') {
          report.skipped.binary++;
          continue;
        }
        const left = FIND_MAX_MATCHES_TOTAL - report.totalMatches;
        const found = findMatches(dec.text, m.re, Math.min(FIND_MAX_MATCHES_PER_FILE, left), 1_000_000);
        if (found.total) {
          const starts = lineStarts(dec.text);
          report.files.push({
            path: abs, rel: r, size: bytes.length, mtimeMs: st.mtimeMs, sha256: sha256Of(bytes), encoding: dec.encoding, bom: dec.bom,
            matches: found.matches.map((x, i) => matchInfo(dec.text, starts, i, x)), total: found.total, truncated: found.total > found.matches.length,
          });
          report.totalMatches += found.matches.length;
          if (report.totalMatches >= FIND_MAX_MATCHES_TOTAL) {
            report.limitReached = true;
            report.partial = true;
            break outer;
          }
        }
      } catch {
        report.skipped.unreadable++;
      }
      const t = Date.now();
      if (t - lastEmit > 120) {
        lastEmit = t;
        onProgress({ files: report.filesSearched, matches: report.totalMatches, current: r });
      }
    }
    for (const d of subdirs.reverse()) stack.push(d);
  }
  onProgress({ files: report.filesSearched, matches: report.totalMatches });
  return report;
}

/** The new bytes for one file, from its current bytes. Throws when the file changed since the search. */
function rebuild(bytes: Buffer, f: ReplaceFile, query: FindQuery, replacement: string, op: string): { data: Buffer; replaced: number; oldText: string; newText: string } {
  if (sha256Of(bytes) !== f.sha256) throw makeError('busy', op, { target: f.path, message: 'The file changed since the search, so nothing was replaced in it. Search again.', retryable: true });
  const dec = decodeFile(bytes);
  if (dec === 'binary') throw makeError('unsupported', op, { target: f.path, message: 'This is not a text file.' });
  const m = buildMatcher(query);
  if (!m.ok) throw makeError('validation', op, { message: m.error });
  const chosen = new Set(f.matches);
  const r = applyReplacements(dec.text, m.re, chosen, replacement, query.regex);
  if (r.replaced !== chosen.size) throw makeError('validation', op, { target: f.path, message: 'The chosen matches are no longer in the file. Search again.' });
  const body = encodeText(r.text, dec.encoding, op);
  const data = dec.bom ? Buffer.concat([bomBytes(dec.encoding), body]) : body;
  return { data, replaced: r.replaced, oldText: dec.text, newText: r.text };
}

const MAX_DIFF_LINES = 400;

/** Line diff of the replacement for each file (two lines of context), checked against the searched hash. */
export async function previewReplacements(query: FindQuery, replacement: string, files: ReplaceFile[]): Promise<ReplacePreview[]> {
  const out: ReplacePreview[] = [];
  for (const f of files) {
    try {
      const bytes = await fsp.readFile(f.path);
      const r = rebuild(bytes, f, query, replacement, 'find.preview');
      const patch = structuredPatch('a', 'b', r.oldText, r.newText, '', '', { context: 2 });
      const lines: DiffLine[] = [];
      let clipped = false;
      for (const h of patch.hunks) {
        if (lines.length) lines.push({ kind: 'gap', text: '' });
        let o = h.oldStart;
        let n = h.newStart;
        for (const l of h.lines) {
          if (l.startsWith('\\')) continue; // "\ No newline at end of file"
          if (lines.length >= MAX_DIFF_LINES) {
            clipped = true;
            break;
          }
          const text = l.slice(1).replace(/\r$/, '');
          if (l[0] === '-') lines.push({ kind: 'del', text, oldLine: o++ });
          else if (l[0] === '+') lines.push({ kind: 'add', text, newLine: n++ });
          else lines.push({ kind: 'same', text, oldLine: o++, newLine: n++ });
        }
        if (clipped) break;
      }
      out.push({ path: f.path, ok: true, replaced: r.replaced, lines, clipped });
    } catch (err) {
      out.push({ path: f.path, ok: false, problem: toOrbisError(err, 'find.preview', f.path, 'no').message, replaced: 0, lines: [], clipped: false });
    }
  }
  return out;
}

/** Checked before the operation is queued: the files listed are exactly the operation's sources. */
export function validateReplaceRequest(req: OperationRequest): void {
  const p = ReplaceParamsSchema.safeParse(req.params);
  if (!p.success) throw makeError('validation', 'ops.find-replace', { message: 'The replacement request is not valid.', cause: p.error.issues[0]?.message });
  const m = buildMatcher(p.data.query);
  if (!m.ok) throw makeError('validation', 'ops.find-replace', { message: m.error });
  const listed = new Set(p.data.files.map((f) => path.resolve(f.path)));
  if (listed.size !== p.data.files.length || req.sources.length !== listed.size || req.sources.some((s) => !listed.has(path.resolve(s)))) {
    throw makeError('validation', 'ops.find-replace', { message: 'The files to change do not match the request.' });
  }
}

export function makeFindReplaceRunner(deps: { snapshot: (p: string) => Promise<{ id: string }>; markRunning: (rec: OperationRecord) => void; onChanged: (p: string) => void }): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const params = ReplaceParamsSchema.parse(req.params);
    // A retry carries only the files that did not finish.
    const files = params.files.filter((f) => rec.sources.includes(f.path));
    rec.progress = { totalItems: files.length, completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    const undo: SnapshotUndoItem[] = [];
    let replacedTotal = 0;
    try {
      for (const f of files) {
        await ctx.gate();
        try {
          const bytes = await fsp.readFile(f.path).catch((err) => {
            throw new OrbisError(toOrbisError(err, 'find.replace', f.path, 'no'));
          });
          const r = rebuild(bytes, f, params.query, params.replacement, 'find.replace');
          let snap: { id: string };
          try {
            snap = await deps.snapshot(f.path);
          } catch (err) {
            throw makeError('unavailable', 'find.replace', { target: f.path, message: `A safety snapshot could not be taken (${toOrbisError(err, 'snapshot').message}). Nothing was changed.` });
          }
          await ctx.gate();
          const w = await replaceFileAtomic(f.path, r.data, f.sha256, helpers, 'find.replace');
          undo.push({ path: f.path, snapshotId: snap.id, sha256After: w.sha256 });
          replacedTotal += r.replaced;
          deps.onChanged(f.path);
          rec.results.push({ source: f.path, destination: f.path, status: 'done' });
        } catch (err) {
          const shape = toOrbisError(err, 'find.replace', f.path, 'no');
          if (shape.category === 'cancelled') throw err;
          rec.results.push({ source: f.path, status: 'failed', error: shape });
        }
        helpers.tick(0, 1, path.basename(f.path));
      }
    } finally {
      rec.undo = undo.length ? { kind: 'snapshots', items: undo } : { kind: 'none', reason: 'Nothing was changed.' };
      if (undo.length) rec.notes = [...(rec.notes ?? []), `Replaced ${replacedTotal} match${replacedTotal === 1 ? '' : 'es'} in ${undo.length} file${undo.length === 1 ? '' : 's'}. Each original is kept as a snapshot; Undo restores them.`];
    }
  };
}
