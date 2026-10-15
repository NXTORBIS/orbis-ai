import fsp from 'node:fs/promises';
import path from 'node:path';
import { degrees, PDFDocument } from 'pdf-lib';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import { parsePageRanges, pdfOutputName, PdfJobSchema, rangesToIndexes, type PagePlanItem, type PdfJob } from '../../shared/docTools';
import type { OperationRecord, OperationRequest } from '../../shared/operations';
import type { ExternalRunner, RunContext, RunnerHelpers } from '../ops/OperationManager';
import { writeNewFile } from './docFiles';

/**
 * PDF tools built on pdf-lib (pure JavaScript, offline): merge, split, extract
 * pages, and rebuild a document from a page plan (delete, rotate, reorder).
 * Sources are only read. Every output is a new file in the destination folder
 * ("name (2).pdf" when the name is taken), written to a temporary file, read
 * back and parsed again (page count checked) before it is committed.
 * Encrypted PDFs are refused: pdf-lib cannot decrypt them, and copying their
 * pages would produce unreadable output.
 */

/** PDFs larger than this are not opened (they are read into memory whole). */
export const PDF_MAX_BYTES = 512 * 1024 * 1024;

export interface PdfInfo {
  path: string;
  size: number;
  encrypted: boolean;
  pageCount: number;
  /** Page sizes in points and their rotation (first 10,000 pages). */
  pages: Array<{ width: number; height: number; rotation: number }>;
  title?: string;
}

async function readPdfBytes(p: string, op: string): Promise<Buffer> {
  const st = await fsp.stat(p).catch((err) => {
    throw new OrbisError(toOrbisError(err, op, p, 'no'));
  });
  if (!st.isFile()) throw makeError('unsupported', op, { target: p, message: 'Only PDF files can be used here.' });
  if (st.size > PDF_MAX_BYTES) throw makeError('unsupported', op, { target: p, message: `PDFs over ${PDF_MAX_BYTES / 1024 / 1024} MB are not opened.` });
  const bytes = await fsp.readFile(p);
  const head = bytes.subarray(0, 1024).toString('latin1');
  if (!head.includes('%PDF-')) throw makeError('validation', op, { target: p, message: `“${path.basename(p)}” is not a PDF file.` });
  return bytes;
}

async function parse(bytes: Uint8Array, p: string, op: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch (err) {
    throw makeError('validation', op, { target: p, message: `“${path.basename(p)}” could not be read as a PDF (${(err as Error).message.split('\n')[0]?.slice(0, 160)}).` });
  }
}

/** Load a PDF for editing; encrypted documents are refused. */
export async function loadPdf(p: string, op = 'pdf.load'): Promise<PDFDocument> {
  const doc = await parse(await readPdfBytes(p, op), p, op);
  if (doc.isEncrypted) {
    throw makeError('unsupported', op, { target: p, message: `“${path.basename(p)}” is encrypted (password-protected or restricted). Orbis Files does not decrypt PDFs, so nothing was made from it.` });
  }
  if (doc.getPageCount() < 1) throw makeError('validation', op, { target: p, message: `“${path.basename(p)}” has no pages.` });
  return doc;
}

export async function pdfInfo(p: string): Promise<PdfInfo> {
  const bytes = await readPdfBytes(p, 'pdf.info');
  const doc = await parse(bytes, p, 'pdf.info');
  let pages: PdfInfo['pages'] = [];
  let pageCount = 0;
  try {
    pageCount = doc.getPageCount();
    pages = doc.getPages().slice(0, 10_000).map((pg) => {
      const { width, height } = pg.getSize();
      return { width, height, rotation: normalizeAngle(pg.getRotation().angle) };
    });
  } catch {
    /* encrypted or damaged page tree: reported with zero pages */
  }
  let title: string | undefined;
  try {
    title = doc.isEncrypted ? undefined : doc.getTitle();
  } catch {
    title = undefined;
  }
  return { path: p, size: bytes.length, encrypted: doc.isEncrypted, pageCount, pages, title };
}

const normalizeAngle = (a: number) => (((Math.round(a / 90) * 90) % 360) + 360) % 360;

/** Copy pages (0-based, in order, repeats allowed) of `src` into a new document, turning each by `rotate[i]` degrees more. */
async function buildFrom(parts: Array<{ doc: PDFDocument; pages: number[]; rotate?: number[] }>, ctx: RunContext): Promise<PDFDocument> {
  const out = await PDFDocument.create();
  out.setProducer('Orbis Files (pdf-lib)');
  out.setCreator('Orbis Files');
  for (const part of parts) {
    await ctx.gate();
    const copied = await out.copyPages(part.doc, part.pages);
    copied.forEach((pg, i) => {
      const base = normalizeAngle(part.doc.getPage(part.pages[i]!).getRotation().angle);
      pg.setRotation(degrees(normalizeAngle(base + (part.rotate?.[i] ?? 0))));
      out.addPage(pg);
    });
  }
  return out;
}

const stem = (p: string) => path.basename(p).replace(/\.pdf$/i, '');
const pad = (n: number, total: number) => String(n).padStart(String(total).length, '0');

interface Output { name: string; build: () => Promise<PDFDocument>; pages: number; source: string }

/** The outputs a job makes, with their names and page counts (validated against the documents). */
async function planOutputs(job: PdfJob, sources: string[], ctx: RunContext): Promise<Output[]> {
  const op = 'pdf.plan';
  const nameOf = (n: string) => {
    const r = pdfOutputName(n);
    if (!r.ok) throw makeError('validation', op, { message: r.error });
    return r.name;
  };
  if (job.action === 'merge') {
    if (sources.length < 2) throw makeError('validation', op, { message: 'Choose two or more PDFs to merge.' });
    const docs: PDFDocument[] = [];
    for (const s of sources) {
      await ctx.gate();
      docs.push(await loadPdf(s, op));
    }
    return [{ name: nameOf(job.output), source: sources[0]!, pages: docs.reduce((n, d) => n + d.getPageCount(), 0), build: () => buildFrom(docs.map((d) => ({ doc: d, pages: d.getPageIndices() })), ctx) }];
  }
  if (sources.length !== 1) throw makeError('validation', op, { message: 'Choose one PDF.' });
  const src = sources[0]!;
  const doc = await loadPdf(src, op);
  const count = doc.getPageCount();
  const ranges = (text: string) => {
    const r = parsePageRanges(text, count);
    if (!r.ok) throw makeError('validation', op, { message: r.error });
    return r.ranges;
  };
  if (job.action === 'split') {
    const base = job.baseName.replace(/\.pdf$/i, '').trim() || stem(src);
    if (job.mode === 'every') {
      if (count > 5000) throw makeError('unsupported', op, { message: 'Splitting into more than 5,000 files is not offered. Split by ranges instead.' });
      return doc.getPageIndices().map((i) => ({ name: nameOf(`${base} - page ${pad(i + 1, count)}`), source: src, pages: 1, build: () => buildFrom([{ doc, pages: [i] }], ctx) }));
    }
    const rs = ranges(job.ranges ?? '');
    return rs.map((r) => {
      const pages = rangesToIndexes([r]);
      return { name: nameOf(r.from === r.to ? `${base} - page ${pad(r.from, count)}` : `${base} - pages ${r.from}-${r.to}`), source: src, pages: pages.length, build: () => buildFrom([{ doc, pages }], ctx) };
    });
  }
  if (job.action === 'extract') {
    const pages = rangesToIndexes(ranges(job.ranges));
    return [{ name: nameOf(job.output), source: src, pages: pages.length, build: () => buildFrom([{ doc, pages }], ctx) }];
  }
  const plan: PagePlanItem[] = job.plan;
  for (const it of plan) if (it.page >= count) throw makeError('validation', op, { message: `Page ${it.page + 1} does not exist; the document has ${count} pages.` });
  return [{ name: nameOf(job.output), source: src, pages: plan.length, build: () => buildFrom([{ doc, pages: plan.map((p) => p.page), rotate: plan.map((p) => p.rotate) }], ctx) }];
}

/** Checked before the operation is queued. */
export function validatePdfRequest(req: OperationRequest): void {
  const parsed = PdfJobSchema.safeParse((req.params as { job?: unknown } | undefined)?.job);
  if (!parsed.success) throw makeError('validation', 'ops.pdf-tools', { message: 'The PDF request is not valid.', cause: parsed.error.issues[0]?.message });
  if (!req.destination) throw makeError('validation', 'ops.pdf-tools', { message: 'Choose a folder for the new PDF.' });
  const job = parsed.data;
  if (job.action === 'merge' ? req.sources.length < 2 : req.sources.length !== 1) throw makeError('validation', 'ops.pdf-tools', { message: job.action === 'merge' ? 'Choose two or more PDFs to merge.' : 'Choose one PDF.' });
  const out = job.action === 'split' ? `${job.baseName}` : job.output;
  const n = pdfOutputName(out);
  if (!n.ok) throw makeError('validation', 'ops.pdf-tools', { message: n.error });
  if (job.action === 'split' && job.mode === 'ranges' && !job.ranges?.trim()) throw makeError('validation', 'ops.pdf-tools', { message: 'Enter the page ranges to split into.' });
}

export function makePdfToolsRunner(deps: { markRunning: (rec: OperationRecord) => void }): ExternalRunner {
  return async (rec, req, ctx, helpers: RunnerHelpers) => {
    const job = PdfJobSchema.parse((req.params as { job?: unknown }).job);
    const dir = rec.destination!;
    const dst = await fsp.stat(dir).catch(() => undefined);
    if (!dst?.isDirectory()) throw makeError('not_a_directory', 'pdf.write', { target: dir, message: 'The destination folder does not exist.' });
    // Results list the files made (several per source when splitting).
    rec.itemResults = true;
    let outputs: Output[];
    try {
      outputs = await planOutputs(job, rec.sources, ctx);
    } catch (err) {
      const shape = toOrbisError(err, 'pdf.plan', rec.sources[0], 'no');
      if (shape.category === 'cancelled') throw err;
      rec.results.push({ source: shape.target ?? rec.sources[0]!, status: 'failed', error: shape });
      rec.error = shape;
      return;
    }
    rec.progress = { totalItems: outputs.length, completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    const made: Array<{ source: string; destination: string; intended: string }> = [];
    try {
      for (const o of outputs) {
        await ctx.gate();
        try {
          const doc = await o.build();
          await ctx.gate();
          const bytes = await doc.save({ useObjectStreams: true });
          const target = await writeNewFile(dir, o.name, bytes, helpers, 'pdf.write', async (written) => {
            const check = await PDFDocument.load(written, { updateMetadata: false });
            if (check.getPageCount() !== o.pages) throw makeError('io', 'pdf.write', { message: `The new PDF did not verify (${check.getPageCount()} pages instead of ${o.pages}).` });
          });
          made.push({ source: o.source, destination: target, intended: o.name });
          rec.results.push({ source: o.source, destination: target, status: 'done' });
          helpers.tick(bytes.length, 1, path.basename(target));
        } catch (err) {
          const shape = toOrbisError(err, 'pdf.write', path.join(dir, o.name), 'no');
          if (shape.category === 'cancelled') throw err;
          rec.results.push({ source: o.source, destination: path.join(dir, o.name), status: 'failed', error: shape });
          helpers.tick(0, 1, o.name);
        }
      }
    } catch (err) {
      for (const o of outputs.slice(rec.results.length)) rec.results.push({ source: o.source, destination: path.join(dir, o.name), status: 'cancelled' });
      throw err;
    } finally {
      rec.undo = made.length ? { kind: 'transfer', mode: 'copy', items: made.map((m) => ({ source: m.source, destination: m.destination })) } : { kind: 'none', reason: 'No file was made.' };
      if (made.length) {
        const renamed = made.filter((m) => path.basename(m.destination) !== m.intended).length;
        rec.notes = [...(rec.notes ?? []), `Made ${made.length} new PDF${made.length === 1 ? '' : 's'}; the original${rec.sources.length === 1 ? ' was' : 's were'} not changed.${renamed ? ` ${renamed} got a numbered name because the name was taken.` : ''}`];
      }
    }
  };
}
