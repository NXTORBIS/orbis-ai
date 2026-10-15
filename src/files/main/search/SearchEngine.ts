import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FileEntry } from '../../shared/model';
import { entryFor, extOf, looksBinary } from '../fs/FileSystemService';
import { matches, TYPE_GROUPS, type Candidate, type EvalContext, type ParsedQuery } from './query';
import type { Indexer } from './Indexer';
import { isWithin } from '../fs/paths';
import { META_EXTS } from '../../shared/media';
import { ocrKindOf, snippetAround } from '../../shared/ocr';

/**
 * Executes parsed queries.
 *  - Live search walks the requested scope without following symlinks.
 *  - Indexed search reads the local index for scopes covered by an index root,
 *    and walks any part of the scope the index does not cover.
 * Results always report what was actually searched.
 */

export interface SearchReport {
  scanned: number;
  matched: number;
  skippedDirs: number;
  complete: boolean;
  cancelled: boolean;
  truncated: boolean;
  usedIndex: string[];
  walked: string[];
  notes: string[];
}

export const MAX_RESULTS = 200_000;
const CONTENT_MAX_BYTES = 1024 * 1024;
const TEXTLIKE = new Set([...TYPE_GROUPS.text!, ...TYPE_GROUPS.code!, 'html', 'htm', 'svg', 'srt', 'vtt', 'tex', 'bib']);

export async function runSearch(
  q: ParsedQuery,
  scope: string[],
  opts: { showHidden: boolean; signal: AbortSignal; onBatch: (entries: FileEntry[]) => void; ctx: EvalContext; indexer?: Indexer; useIndex: boolean },
): Promise<SearchReport> {
  const report: SearchReport = { scanned: 0, matched: 0, skippedDirs: 0, complete: false, cancelled: false, truncated: false, usedIndex: [], walked: [], notes: [] };
  if (q.usesTags && !opts.ctx.tagLookup) report.notes.push('Tag filters need the catalogue; none was available.');
  if (q.usesCatalog && !opts.ctx.catalog) report.notes.push('Note, rating, source, collection and project filters need the catalogue; none was available.');
  if (q.usesMeta) report.notes.push('Dimension, duration, page and photo filters read each media file, so this search is slower.');
  const needsAccessed = q.groups.some((g) => g.some((c) => c.field === 'accessed'));
  const contentNeedle = q.groups.flat().find((c) => c.field === 'content' && !c.negate)?.value;
  /** Search results matched through text recognized in an image carry a badge and an excerpt. */
  const mark = (e: FileEntry, cand: Candidate): FileEntry => (cand.contentSource === 'image-text' && cand.content ? { ...e, textMatch: { source: 'image-text', snippet: snippetAround(cand.content, contentNeedle ?? '') } } : e);
  const roots = dedupeRoots(scope);
  let pending: FileEntry[] = [];
  const flush = () => {
    if (pending.length) {
      opts.onBatch(pending);
      pending = [];
    }
  };
  let flushTimer: NodeJS.Timeout | undefined;
  const emit = (e: FileEntry) => {
    report.matched++;
    pending.push(e);
    if (pending.length >= 200) flush();
    else if (!flushTimer) {
      // The first match is shown at once; later ones follow in short batches instead of waiting for 200.
      flushTimer = setTimeout(() => {
        flushTimer = undefined;
        flush();
      }, report.matched === 1 ? 0 : 40);
    }
    if (report.matched >= MAX_RESULTS) report.truncated = true;
  };

  for (const root of roots) {
    if (opts.signal.aborted || report.truncated) break;
    const covering = opts.useIndex ? opts.indexer?.coveringRoot(root) : undefined;
    if (covering) {
      report.usedIndex.push(root);
      for (const row of opts.indexer!.entriesUnder(root)) {
        if (opts.signal.aborted || report.truncated) break;
        report.scanned++;
        if (!opts.showHidden && row.name.startsWith('.')) continue;
        const cand: Candidate = { ...row };
        if (needsAccessed) cand.accessedMs = (await entryFor(row.path).catch(() => undefined))?.accessedMs;
        if (q.usesMeta && row.kind === 'file' && META_EXTS.has(row.ext)) cand.meta = await opts.ctx.metaLookup?.(row.path).catch(() => undefined);
        if (q.usesContent && row.kind === 'file' && !cand.content) imageText(cand, opts.ctx);
        if (matches(q, cand, opts.ctx)) {
          // Verify the indexed entry still exists before presenting it as current.
          try {
            emit(mark(await entryFor(row.path), cand));
          } catch {
            /* stale index row: not shown */
          }
        }
      }
      if (q.usesContent && !opts.indexer!.contentEnabled) report.notes.push('Content is not indexed (enable "Index file contents" in Settings); content: filters matched nothing in indexed folders.');
      continue;
    }
    report.walked.push(root);
    await walk(root, q, opts, report, emit, mark);
  }
  if (flushTimer) clearTimeout(flushTimer);
  flush();
  report.cancelled = opts.signal.aborted;
  report.complete = !report.cancelled && !report.truncated && report.skippedDirs === 0;
  if (report.truncated) report.notes.push(`Stopped after ${MAX_RESULTS.toLocaleString()} matches. Narrow the query to see the rest.`);
  if (report.skippedDirs) report.notes.push(`${report.skippedDirs} folder(s) could not be read and were not searched.`);
  return report;
}

function dedupeRoots(scope: string[]): string[] {
  const sorted = [...new Set(scope.map((s) => path.resolve(s)))].sort((a, b) => a.length - b.length);
  const out: string[] = [];
  for (const s of sorted) if (!out.some((o) => isWithin(o, s))) out.push(s);
  return out;
}

const WALK_WORKERS = 24;

async function walk(
  root: string,
  q: ParsedQuery,
  opts: { showHidden: boolean; signal: AbortSignal; ctx: EvalContext },
  report: SearchReport,
  emit: (e: FileEntry) => void,
  mark: (e: FileEntry, cand: Candidate) => FileEntry,
): Promise<void> {
  const queue: string[] = [root];
  const needStat = q.groups.some((g) => g.some((c) => c.field === 'size' || c.field === 'modified' || c.field === 'created' || c.field === 'accessed'));
  let active = 0;
  const stop = () => opts.signal.aborted || report.truncated;

  const visit = async (dir: string): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      report.skippedDirs++;
      return;
    }
    for (const d of entries) {
      if (stop()) return;
      if (!opts.showHidden && d.name.startsWith('.')) continue;
      const p = path.join(dir, d.name);
      report.scanned++;
      const kind: Candidate['kind'] = d.isSymbolicLink() ? 'symlink' : d.isDirectory() ? 'directory' : d.isFile() ? 'file' : 'other';
      let entry: FileEntry | undefined;
      if (needStat) {
        try {
          entry = await entryFor(p);
        } catch {
          continue;
        }
      }
      const cand: Candidate = {
        path: p,
        name: d.name,
        ext: kind === 'directory' ? '' : extOf(d.name),
        kind,
        size: entry?.size,
        modifiedMs: entry?.modifiedMs,
        createdMs: entry?.createdMs,
        accessedMs: entry?.accessedMs,
      };
      if (q.usesContent && kind === 'file' && TEXTLIKE.has(cand.ext)) cand.content = await readSmallText(p);
      else if (q.usesContent && kind === 'file' && opts.ctx.imageText && ocrKindOf(d.name) === 'image') {
        // Recognized text is only used while the image still has the size and time it was recognized at.
        if (cand.size === undefined || cand.modifiedMs === undefined) {
          const st = await fsp.lstat(p).catch(() => undefined);
          cand.size = st?.size;
          cand.modifiedMs = st?.mtimeMs;
        }
        imageText(cand, opts.ctx);
      }
      if (q.usesMeta && kind === 'file' && META_EXTS.has(cand.ext)) cand.meta = await opts.ctx.metaLookup?.(p).catch(() => undefined);
      if (matches(q, cand, opts.ctx)) {
        try {
          emit(mark(entry ?? (await entryFor(p)), cand));
        } catch {
          /* vanished between listing and stat */
        }
      }
      // Links are never followed, so a real folder cannot lead back to itself; no per-folder check is needed.
      if (kind === 'directory') queue.push(p);
    }
  };

  await new Promise<void>((resolve) => {
    const pump = (): void => {
      while (active < WALK_WORKERS && queue.length && !stop()) {
        const dir = queue.pop()!;
        active++;
        void visit(dir)
          .catch(() => {
            report.skippedDirs++;
          })
          .finally(() => {
            active--;
            pump();
          });
      }
      if (active === 0 && (queue.length === 0 || stop())) resolve();
    };
    pump();
  });
}

export async function readSmallText(p: string): Promise<string | null> {
  try {
    const st = await fsp.stat(p);
    if (st.size > CONTENT_MAX_BYTES) return null;
    const buf = await fsp.readFile(p);
    if (looksBinary(buf)) return null;
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

/** Give an image candidate its recognized text (OCR), when the content store has it for this version of the file. */
function imageText(cand: Candidate, ctx: EvalContext): void {
  if (!ctx.imageText || ocrKindOf(cand.name) !== 'image') return;
  const text = ctx.imageText(cand.path, cand.size, cand.modifiedMs);
  if (text) {
    cand.content = text;
    cand.contentSource = 'image-text';
  }
}

export function isTextLike(ext: string): boolean {
  return TEXTLIKE.has(ext);
}
