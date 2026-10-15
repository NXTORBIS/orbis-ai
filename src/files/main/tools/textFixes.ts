import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import { TextFixSpecSchema, type TextEncodingName, type TextFixPreview, type TextFixSpec } from '../../shared/docTools';
import type { OperationRecord, OperationRequest } from '../../shared/operations';
import type { ExternalRunner } from '../ops/OperationManager';
import { bomBytes, bomLength, decodeText, detectText, encodeText } from './textCodec';
import { replaceFileAtomic, sha256Of, type SnapshotUndoItem } from './docFiles';

/**
 * Text fixes for selected files: convert to UTF-8 (from the detected or a
 * chosen encoding), set line endings (LF or CRLF), trim trailing spaces and
 * tabs, ensure a final newline, remove a UTF-8 byte-order mark. The preview
 * and the 'text-fix' operation build the new bytes with the same function;
 * the operation re-checks each file's SHA-256, snapshots it and replaces it
 * atomically, and undo restores the snapshots.
 */

export const TEXT_FIX_MAX_BYTES = 64 * 1024 * 1024;

export interface TransformResult { text: string; linesTrimmed: number; lineEndingsChanged: number; finalNewlineAdded: boolean }

export function countLineEndings(text: string): { lf: number; crlf: number; cr: number } {
  let lf = 0;
  let crlf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else cr++;
    } else if (c === 10) lf++;
  }
  return { lf, crlf, cr };
}

/** Apply the whitespace and line-ending fixes to decoded text. */
export function transformText(text: string, spec: Pick<TextFixSpec, 'lineEndings' | 'trimTrailing' | 'finalNewline'>): TransformResult {
  const counts = countLineEndings(text);
  const dominant = counts.crlf > counts.lf && counts.crlf >= counts.cr ? '\r\n' : counts.cr > counts.lf && counts.cr > counts.crlf ? '\r' : '\n';
  const target = spec.lineEndings === 'lf' ? '\n' : spec.lineEndings === 'crlf' ? '\r\n' : undefined;
  const parts = text.split(/(\r\n|\n|\r)/);
  let out = '';
  let linesTrimmed = 0;
  let lineEndingsChanged = 0;
  for (let i = 0; i < parts.length; i += 2) {
    let line = parts[i]!;
    const eol = parts[i + 1];
    if (spec.trimTrailing) {
      const t = line.replace(/[ \t]+$/, '');
      if (t !== line) linesTrimmed++;
      line = t;
    }
    out += line;
    if (eol !== undefined) {
      const next = target ?? eol;
      if (next !== eol) lineEndingsChanged++;
      out += next;
    }
  }
  let finalNewlineAdded = false;
  if (spec.finalNewline && out.length && !/[\r\n]$/.test(out)) {
    out += target ?? dominant;
    finalNewlineAdded = true;
  }
  return { text: out, linesTrimmed, lineEndingsChanged, finalNewlineAdded };
}

interface Plan {
  encoding: TextEncodingName;
  encodingSource: 'bom' | 'detected' | 'chosen';
  bom: boolean;
  text: string;
  data: Buffer;
  result: TransformResult;
  converted: boolean;
  bomRemoved: boolean;
}

/** How a file reads and what the fixes make of it. Throws an 'unsupported' or 'validation' error when it is left alone. */
export function planTextFix(bytes: Buffer, spec: TextFixSpec, op = 'text.fix'): Plan {
  const detected = detectText(bytes);
  let encoding: TextEncodingName;
  let encodingSource: Plan['encodingSource'];
  if (spec.from === 'auto') {
    if (detected.binary) throw makeError('unsupported', op, { message: 'This looks like a binary file, not text, so it is left alone.' });
    encoding = detected.encoding;
    encodingSource = detected.source;
  } else {
    encoding = spec.from;
    encodingSource = 'chosen';
    // Binary content is refused unless the file was chosen as UTF-16 (whose text has zero bytes).
    if (detected.binary && encoding !== 'utf16le' && encoding !== 'utf16be') throw makeError('unsupported', op, { message: 'This looks like a binary file, not text, so it is left alone.' });
  }
  const bom = bomLength(bytes, encoding);
  const text = decodeText(bytes.subarray(bom), encoding, op);
  if (/[\0]/.test(text) && encoding !== 'utf16le' && encoding !== 'utf16be') throw makeError('unsupported', op, { message: 'The text contains NUL characters, so it is treated as binary and left alone.' });
  const result = transformText(text, spec);
  const outEncoding: TextEncodingName = spec.toUtf8 ? 'utf8' : encoding;
  const converted = spec.toUtf8 && encoding !== 'utf8';
  // UTF-8 output drops the BOM when converting or when asked; UTF-16 kept as UTF-16 keeps its BOM.
  let keepBom = bom > 0;
  if (converted) keepBom = false;
  if (outEncoding === 'utf8' && spec.removeBom) keepBom = false;
  const body = encodeText(result.text, outEncoding, op);
  const data = keepBom ? Buffer.concat([bomBytes(outEncoding), body]) : body;
  return { encoding, encodingSource, bom: bom > 0, text, data, result, converted, bomRemoved: bom > 0 && !keepBom };
}

const printable = (s: string) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '·');

/** Preview the fixes for each file (nothing is written). */
export async function previewTextFixes(paths: string[], spec: TextFixSpec): Promise<TextFixPreview[]> {
  const out: TextFixPreview[] = [];
  for (const p of paths) {
    const item: TextFixPreview = { path: p, size: 0 };
    try {
      const st = await fsp.lstat(p);
      item.size = st.size;
      if (st.isSymbolicLink()) throw makeError('unsupported', 'text.fix', { message: 'Links are left alone; select the file they point to.' });
      if (!st.isFile()) throw makeError('unsupported', 'text.fix', { message: 'Only files can be fixed.' });
      if (st.size > TEXT_FIX_MAX_BYTES) throw makeError('unsupported', 'text.fix', { message: `Files over ${TEXT_FIX_MAX_BYTES / 1024 / 1024} MB are left alone.` });
      const bytes = await fsp.readFile(p);
      item.sha256 = sha256Of(bytes);
      const plan = planTextFix(bytes, spec);
      const eol = countLineEndings(plan.text);
      item.encoding = plan.encoding;
      item.encodingSource = plan.encodingSource;
      item.bom = plan.bom;
      item.lineEndings = eol;
      item.trailingWhitespaceLines = plan.text.split(/\r\n|\n|\r/).filter((l) => /[ \t]+$/.test(l)).length;
      item.endsWithNewline = !plan.text.length || /[\r\n]$/.test(plan.text);
      item.sample = printable(plan.text.slice(0, 160).replace(/\r\n|\r|\n/g, ' ⏎ '));
      item.changes = { converted: plan.converted, bomRemoved: plan.bomRemoved, lineEndingsChanged: plan.result.lineEndingsChanged, linesTrimmed: plan.result.linesTrimmed, finalNewlineAdded: plan.result.finalNewlineAdded };
      item.changed = !plan.data.equals(bytes);
      item.newSize = plan.data.length;
    } catch (err) {
      item.refused = toOrbisError(err, 'text.fix', p, 'no').message;
    }
    out.push(item);
  }
  return out;
}

export const TextFixParamsSchema = z.object({
  spec: TextFixSpecSchema,
  files: z.array(z.object({ path: z.string().min(1).max(32767), sha256: z.string().regex(/^[0-9a-f]{64}$/) })).min(1).max(20_000),
});

export function validateTextFixRequest(req: OperationRequest): void {
  const p = TextFixParamsSchema.safeParse(req.params);
  if (!p.success) throw makeError('validation', 'ops.text-fix', { message: 'The text-fix request is not valid.', cause: p.error.issues[0]?.message });
  const s = p.data.spec;
  if (!s.toUtf8 && s.lineEndings === 'keep' && !s.trimTrailing && !s.finalNewline && !s.removeBom) throw makeError('validation', 'ops.text-fix', { message: 'Choose at least one fix.' });
  const listed = new Set(p.data.files.map((f) => path.resolve(f.path)));
  if (listed.size !== p.data.files.length || req.sources.length !== listed.size || req.sources.some((x) => !listed.has(path.resolve(x)))) {
    throw makeError('validation', 'ops.text-fix', { message: 'The files to change do not match the request.' });
  }
}

export function makeTextFixRunner(deps: { snapshot: (p: string) => Promise<{ id: string }>; markRunning: (rec: OperationRecord) => void; onChanged: (p: string) => void }): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const params = TextFixParamsSchema.parse(req.params);
    const files = params.files.filter((f) => rec.sources.includes(f.path));
    rec.progress = { totalItems: files.length, completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    const undo: SnapshotUndoItem[] = [];
    let unchanged = 0;
    try {
      for (const f of files) {
        await ctx.gate();
        try {
          const st = await fsp.lstat(f.path).catch((err) => {
            throw new OrbisError(toOrbisError(err, 'text.fix', f.path, 'no'));
          });
          if (!st.isFile()) throw makeError('unsupported', 'text.fix', { target: f.path, message: 'Only regular files are changed (not links or folders).' });
          const bytes = await fsp.readFile(f.path);
          if (sha256Of(bytes) !== f.sha256) throw makeError('busy', 'text.fix', { target: f.path, message: 'The file changed since the preview, so it was not changed. Preview again.', retryable: true });
          const plan = planTextFix(bytes, params.spec);
          if (plan.data.equals(bytes)) {
            unchanged++;
            rec.results.push({ source: f.path, status: 'skipped' });
          } else {
            let snap: { id: string };
            try {
              snap = await deps.snapshot(f.path);
            } catch (err) {
              throw makeError('unavailable', 'text.fix', { target: f.path, message: `A safety snapshot could not be taken (${toOrbisError(err, 'snapshot').message}). Nothing was changed.` });
            }
            await ctx.gate();
            const w = await replaceFileAtomic(f.path, plan.data, f.sha256, helpers, 'text.fix');
            undo.push({ path: f.path, snapshotId: snap.id, sha256After: w.sha256 });
            deps.onChanged(f.path);
            rec.results.push({ source: f.path, destination: f.path, status: 'done' });
          }
        } catch (err) {
          const shape = toOrbisError(err, 'text.fix', f.path, 'no');
          if (shape.category === 'cancelled') throw err;
          rec.results.push({ source: f.path, status: 'failed', error: shape });
        }
        helpers.tick(0, 1, path.basename(f.path));
      }
    } finally {
      rec.undo = undo.length ? { kind: 'snapshots', items: undo } : { kind: 'none', reason: 'Nothing was changed.' };
      const notes: string[] = [];
      if (undo.length) notes.push(`Fixed ${undo.length} file${undo.length === 1 ? '' : 's'}. Each original is kept as a snapshot; Undo restores them.`);
      if (unchanged) notes.push(`${unchanged} file${unchanged === 1 ? ' was' : 's were'} already as requested and left unchanged.`);
      if (notes.length) rec.notes = [...(rec.notes ?? []), ...notes];
    }
  };
}
