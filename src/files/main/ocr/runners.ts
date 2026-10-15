import fsp from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { makeError, toOrbisError } from '../../shared/errors';
import {
  DEFAULT_MARKDOWN_NAME, OCR_BATCH_MAX_FILES, OcrExtractParamsSchema, OcrSaveParamsSchema, markdownDocument, markdownOutputName,
  ocrKindOf, searchablePdfName, textOutputName, type OcrResult,
} from '../../shared/ocr';
import type { OperationRecord, OperationRequest } from '../../shared/operations';
import type { ExternalRunner } from '../ops/OperationManager';
import { writeNewFile } from '../tools/docFiles';
import type { OcrEngine } from './engine';
import { recognizeFile, type PdfRasterizer } from './recognize';

/**
 * Operation runners:
 *  - 'ocr-extract' ("Extract text to files"): recognizes each image/PDF (folders: the
 *    images and PDFs inside) and writes a .txt next to each, or one Markdown file with
 *    a heading per file, plus optional searchable PDFs. Pausable between files and
 *    pages; cancelling stops the engine at once. New files only (a taken name gets a
 *    number); Undo moves the created files to the Trash.
 *  - 'ocr-save' ("Save as .txt" in the panel): writes recognized text next to its file.
 */

export interface OcrRunnerDeps {
  engine: OcrEngine;
  rasterizer: () => PdfRasterizer | undefined;
  markRunning: (rec: OperationRecord) => void;
  onCreated?: (p: string) => void;
}

/** Files to recognize: selected images/PDFs, and those inside selected folders (links and hidden items left out). */
async function expandSources(sources: string[], includeSubfolders: boolean, signal: AbortSignal): Promise<{ files: string[]; refused: Array<{ path: string; reason: string }>; truncated: boolean }> {
  const files: string[] = [];
  const refused: Array<{ path: string; reason: string }> = [];
  let truncated = false;
  const add = (p: string) => {
    if (files.length >= OCR_BATCH_MAX_FILES) truncated = true;
    else if (!files.includes(p)) files.push(p);
  };
  for (const src of sources) {
    const st = await fsp.lstat(src).catch(() => undefined);
    if (!st) {
      refused.push({ path: src, reason: 'It no longer exists.' });
      continue;
    }
    if (st.isFile()) {
      if (ocrKindOf(path.basename(src))) add(src);
      else refused.push({ path: src, reason: 'Not an image or PDF.' });
      continue;
    }
    if (!st.isDirectory()) {
      refused.push({ path: src, reason: 'Links are not followed; select the item they point to.' });
      continue;
    }
    const stack = [src];
    while (stack.length && !truncated) {
      if (signal.aborted) throw makeError('cancelled', 'ocr.extract');
      const dir = stack.shift()!;
      const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
      entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      for (const d of entries) {
        if (d.name.startsWith('.')) continue;
        const p = path.join(dir, d.name);
        if (d.isFile() && ocrKindOf(d.name)) add(p);
        else if (d.isDirectory() && includeSubfolders) stack.push(p);
      }
    }
  }
  return { files, refused, truncated };
}

/** A searchable PDF must parse again and keep its page count before it is committed. */
async function verifyPdf(bytes: Buffer, pages: number): Promise<void> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false }).catch(() => undefined);
  if (!doc || doc.getPageCount() !== pages) throw makeError('io', 'ocr.extract', { message: 'The searchable PDF did not verify after writing; it was not kept.' });
}

export function makeOcrExtractRunner(deps: OcrRunnerDeps): { run: ExternalRunner; validate: (req: OperationRequest) => void } {
  const validate = (req: OperationRequest) => {
    const p = OcrExtractParamsSchema.safeParse(req.params);
    if (!p.success) throw makeError('validation', 'ocr.extract', { message: p.error.issues[0]?.message ?? 'The settings are not valid.' });
    if (p.data.output === 'markdown') {
      if (!req.destination) throw makeError('validation', 'ocr.extract', { message: 'Choose where to save the Markdown file.' });
      const n = markdownOutputName(p.data.markdownName ?? DEFAULT_MARKDOWN_NAME);
      if (!n.ok) throw makeError('invalid_name', 'ocr.extract', { message: n.error });
    }
    if (!req.sources.length) throw makeError('validation', 'ocr.extract', { message: 'Select images, PDFs or folders.' });
  };
  const run: ExternalRunner = async (rec, req, ctx, helpers) => {
    const params = OcrExtractParamsSchema.parse(req.params);
    const { files, refused, truncated } = await expandSources(rec.sources, params.includeSubfolders, ctx.signal);
    for (const r of refused) rec.results.push({ source: r.path, status: 'skipped', error: { category: 'unsupported', operation: 'ocr.extract', message: r.reason, dataChanged: 'no', retryable: false, target: r.path } });
    if (!files.length) throw makeError('validation', 'ocr.extract', { message: refused.length ? 'None of the selected items is an image or PDF.' : 'No images or PDFs were found.' });
    rec.itemResults = true;
    rec.progress = { totalItems: files.length, completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    const created: Array<{ source: string; destination: string }> = [];
    const collected: Array<{ label: string; result?: OcrResult; error?: string }> = [];
    const notes: string[] = [];
    let low = 0;
    let empty = 0;
    let textPdfs = 0;
    const base = req.destination ?? path.dirname(files[0]!);
    const commit = (p: string, source: string) => {
      created.push({ source, destination: p });
      deps.onCreated?.(p);
    };
    for (let i = 0; i < files.length; i++) {
      const src = files[i]!;
      await ctx.gate();
      const name = path.basename(src);
      const label = path.relative(base, src) && !path.relative(base, src).startsWith('..') ? path.relative(base, src) : src;
      try {
        const r = await recognizeFile(src, params.options, {
          engine: deps.engine,
          rasterizer: deps.rasterizer(),
          lane: 'batch',
          signal: ctx.signal,
          gate: () => ctx.gate(),
          searchablePdf: params.searchablePdf,
          onProgress: (p) => {
            rec.progress.currentItem = p.pages && p.pages > 1 ? `${name} · page ${p.page}/${p.pages}` : name;
            rec.progress.fraction = (i + p.fraction) / files.length;
            helpers.tick(0, 0, rec.progress.currentItem);
          },
        });
        const result = r.result;
        if (result.lowConfidence) low++;
        if (result.pdfKind === 'has-text') textPdfs++;
        let destination: string | undefined;
        if (params.output === 'txt') {
          if (result.text.trim()) {
            destination = await writeNewFile(path.dirname(src), textOutputName(name), Buffer.from(`${result.text}\n`, 'utf8'), helpers, 'ocr.extract');
            commit(destination, src);
          } else empty++;
        } else collected.push({ label, result });
        if (r.pdf) {
          const pdfPath = await writeNewFile(path.dirname(src), searchablePdfName(name), r.pdf, helpers, 'ocr.extract', (b) => verifyPdf(b, result.pageCount));
          commit(pdfPath, src);
          destination ??= pdfPath;
        } else if (r.pdfSkipped) notes.push(`${name}: ${r.pdfSkipped}`);
        if (params.output === 'txt' && !result.text.trim() && !r.pdf) {
          rec.results.push({ source: src, status: 'skipped', error: { category: 'validation', operation: 'ocr.extract', message: 'No text was found.', dataChanged: 'no', retryable: false, target: src } });
        } else rec.results.push({ source: src, destination, status: 'done' });
      } catch (err) {
        const shape = toOrbisError(err, 'ocr.extract', src, 'no');
        if (shape.category === 'cancelled') {
          rec.undo = created.length ? { kind: 'transfer', mode: 'copy', items: created } : { kind: 'none', reason: 'No files were created.' };
          throw err;
        }
        rec.results.push({ source: src, status: 'failed', error: shape });
        if (params.output === 'markdown') collected.push({ label, error: shape.message });
      }
      // Progress is counted in files and pages (a byte rate would mean nothing for recognition).
      rec.progress.fraction = (i + 1) / files.length;
      helpers.tick(0, 1, name);
    }
    if (params.output === 'markdown' && collected.some((c) => c.result)) {
      const mdName = (markdownOutputName(params.markdownName ?? DEFAULT_MARKDOWN_NAME) as { name: string }).name;
      const md = await writeNewFile(req.destination!, mdName, Buffer.from(markdownDocument(collected, Date.now()), 'utf8'), helpers, 'ocr.extract');
      commit(md, req.destination!);
      for (const r of rec.results) if (r.status === 'done' && !r.destination) r.destination = md;
      notes.unshift(`Saved ${path.basename(md)} with the text of ${collected.filter((c) => c.result).length} file${collected.length === 1 ? '' : 's'}.`);
    }
    if (truncated) notes.push(`Only the first ${OCR_BATCH_MAX_FILES.toLocaleString()} files were processed.`);
    if (low) notes.push(`${low} file${low === 1 ? ' was' : 's were'} recognized with low confidence; check ${low === 1 ? 'its' : 'their'} text.`);
    if (empty) notes.push(`No text was found in ${empty} file${empty === 1 ? '' : 's'}; no .txt was made for ${empty === 1 ? 'it' : 'them'}.`);
    if (textPdfs) notes.push(`${textPdfs} PDF${textPdfs === 1 ? '' : 's'} already had text; it was taken from the PDF.`);
    rec.notes = notes;
    rec.undo = created.length ? { kind: 'transfer', mode: 'copy', items: created } : { kind: 'none', reason: 'No files were created.' };
  };
  return { run, validate };
}

export function makeOcrSaveRunner(deps: Pick<OcrRunnerDeps, 'markRunning' | 'onCreated'>): { run: ExternalRunner; validate: (req: OperationRequest) => void } {
  const validate = (req: OperationRequest) => {
    if (req.sources.length !== 1) throw makeError('validation', 'ocr.save', { message: 'Save the text of one file at a time.' });
    const p = OcrSaveParamsSchema.safeParse(req.params);
    if (!p.success) throw makeError('validation', 'ocr.save', { message: p.error.issues[0]?.message ?? 'The text is not valid.' });
    if (!p.data.text.trim()) throw makeError('validation', 'ocr.save', { message: 'There is no text to save.' });
  };
  const run: ExternalRunner = async (rec, req, ctx, helpers) => {
    const { text } = OcrSaveParamsSchema.parse(req.params);
    const src = rec.sources[0]!;
    rec.progress = { totalItems: 1, completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    await ctx.gate();
    const dir = path.dirname(src);
    const st = await fsp.stat(dir).catch(() => undefined);
    if (!st?.isDirectory()) throw makeError('not_found', 'ocr.save', { target: dir, message: 'The folder of this file no longer exists.' });
    const data = Buffer.from(`${text.replace(/\r\n?/g, '\n').trimEnd()}\n`, 'utf8');
    const dest = await writeNewFile(dir, textOutputName(path.basename(src)), data, helpers, 'ocr.save');
    deps.onCreated?.(dest);
    rec.results.push({ source: src, destination: dest, status: 'done' });
    helpers.tick(data.length, 1, path.basename(dest));
    // The text is not kept in the operation history once it is saved.
    if (req.params) delete (req.params as { text?: unknown }).text;
    rec.undo = { kind: 'transfer', mode: 'copy', items: [{ source: src, destination: dest }] };
  };
  return { run, validate };
}
