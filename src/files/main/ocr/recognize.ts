import fsp from 'node:fs/promises';
import path from 'node:path';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import {
  MIN_TEXT_LAYER_CHARS, OCR_LIMITS, meanConfidence, ocrKindOf, summarizePages, visibleChars,
  type OcrPageResult, type OcrResult, type OcrRunOptions, type QuarterTurn,
} from '../../shared/ocr';
import { readMetadata } from '../media/metadata';
import type { OcrEngine, OcrLane, OcrLease, RecognizeOutput } from './engine';

/**
 * Recognizes one image or PDF. Images go to the engine as they are (the engine
 * decodes PNG, JPEG, WebP, BMP, GIF and most TIFFs itself). PDF pages are first
 * checked for a text layer and, when they need recognition, rendered to images
 * with PDF.js by a `PdfRasterizer` (in the app: a hidden, sandboxed page of the
 * app's own renderer — see rasterView.ts). Nothing is written here; callers save
 * results (panel, batch operation, background job).
 */

export interface RasterPage {
  /** The page's own text (text layer), lines joined with newlines; '' when it has none. */
  text: string;
  /** Rendered page (PNG) when asked for. */
  png?: Uint8Array;
  width: number;
  height: number;
  /** Resolution the page was rendered at. */
  dpi: number;
}

export interface RasterDoc {
  pageCount: number;
  page(index: number, opts: { render: boolean; dpi: number; maxPixels: number }, signal?: AbortSignal): Promise<RasterPage>;
  close(): void;
}

export interface PdfRasterizer {
  openPdf(bytes: Uint8Array, signal?: AbortSignal): Promise<RasterDoc>;
  /** Decode an image the engine could not read (formats Chromium decodes) into PNG, orientation applied. */
  decodeImage?(bytes: Uint8Array, mime: string, signal?: AbortSignal): Promise<{ png: Uint8Array; width: number; height: number }>;
}

export interface RecognizeDeps {
  engine: OcrEngine;
  rasterizer?: PdfRasterizer;
  lane: OcrLane;
  signal?: AbortSignal;
  /** Waits while the caller is paused (operations: between pages). */
  gate?: () => Promise<void>;
  onProgress?: (p: { stage: string; fraction: number; page?: number; pages?: number }) => void;
  /** Also make a searchable PDF (images and scanned PDFs only). */
  searchablePdf?: boolean;
  /** Tighter limits for the background job. */
  limits?: { maxBytes?: number; maxMegapixels?: number };
}

export interface RecognizeFileResult {
  result: OcrResult;
  /** The searchable PDF, when asked for and possible. */
  pdf?: Uint8Array;
  /** Why no searchable PDF was made, when one was asked for. */
  pdfSkipped?: string;
}

const MAGIC: Array<[string, (b: Buffer) => boolean]> = [
  ['image/png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/gif', (b) => b.subarray(0, 4).toString('latin1') === 'GIF8'],
  ['image/bmp', (b) => b[0] === 0x42 && b[1] === 0x4d],
  ['image/webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
  ['image/tiff', (b) => ['II*\0', 'MM\0*'].includes(b.subarray(0, 4).toString('latin1'))],
];
export const sniffImage = (b: Buffer): string | undefined => MAGIC.find(([, test]) => test(b))?.[0];

const pageFrom = (index: number, out: RecognizeOutput): OcrPageResult => ({
  index,
  source: 'ocr',
  text: out.text.replace(/\n{3,}/g, '\n\n').trim(),
  confidence: out.words.length ? meanConfidence(out.words) : null,
  words: out.words,
  width: out.width,
  height: out.height,
  turn: out.turn as QuarterTurn,
  skew: out.skew,
});

const failedPage = (index: number, err: unknown): OcrPageResult => ({ index, source: 'failed', text: '', confidence: null, words: [], width: 0, height: 0, turn: 0, skew: 0, error: toOrbisError(err, 'ocr.page').message });

export async function recognizeFile(file: string, options: OcrRunOptions, deps: RecognizeDeps): Promise<RecognizeFileResult> {
  const op = 'ocr.recognize';
  const started = Date.now();
  const st = await fsp.stat(file).catch((err) => {
    throw new OrbisError(toOrbisError(err, op, file, 'no'));
  });
  if (!st.isFile()) throw makeError('unsupported', op, { target: file, message: 'Text can be recognized in image and PDF files only.' });
  const kind = ocrKindOf(path.basename(file));
  if (!kind) throw makeError('unsupported', op, { target: file, message: 'Text can be recognized in PNG, JPEG, WebP, BMP, GIF, TIFF and PDF files.' });
  const base = { path: file, kind, size: st.size, mtimeMs: st.mtimeMs, langs: options.langs, notes: [] as string[] };
  const progress = (stage: string, fraction: number, page?: number, pages?: number) => deps.onProgress?.({ stage, fraction, page, pages });

  if (kind === 'image') {
    const maxBytes = deps.limits?.maxBytes ?? OCR_LIMITS.maxImageBytes;
    if (st.size > maxBytes) throw makeError('unsupported', op, { target: file, message: `Images over ${Math.round(maxBytes / 1024 / 1024)} MB are not recognized.` });
    const bytes = await fsp.readFile(file);
    const mime = sniffImage(bytes);
    if (!mime) throw makeError('validation', op, { target: file, message: `“${path.basename(file)}” is not an image the engine can read (its contents are not PNG, JPEG, WebP, BMP, GIF or TIFF).` });
    const meta = await readMetadata(file).catch(() => undefined);
    const maxMp = deps.limits?.maxMegapixels ?? OCR_LIMITS.maxMegapixels;
    if (meta?.width && meta.height && meta.width * meta.height > maxMp * 1_000_000) {
      throw makeError('unsupported', op, { target: file, message: `This image has ${((meta.width * meta.height) / 1e6).toFixed(1)} megapixels; images over ${maxMp} megapixels are not recognized.` });
    }
    const lease = await deps.engine.acquire(deps.lane, deps.signal);
    let pdf: Uint8Array | undefined;
    let out: RecognizeOutput;
    try {
      progress('Recognizing text', 0);
      const onProgress = (f: number) => progress('Recognizing text', f);
      if (deps.searchablePdf) await lease.pdfBegin(path.basename(file), options.langs, { signal: deps.signal });
      try {
        out = await lease.recognize(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), { langs: options.langs, orientation: meta?.orientation ?? 1, detectOrientation: options.detectOrientation, signal: deps.signal, onProgress, addToPdf: deps.searchablePdf });
      } catch (err) {
        // Formats or variants the engine cannot decode: let Chromium decode them (when the app provides it).
        const e = toOrbisError(err, op);
        // (Chromium cannot read TIFF, so a TIFF the engine refuses is reported as it is.)
        if (e.category === 'cancelled' || !/could not be decoded/.test(e.message) || !deps.rasterizer?.decodeImage || mime === 'image/tiff') throw err;
        const dec = await deps.rasterizer.decodeImage(new Uint8Array(bytes), mime, deps.signal);
        out = await lease.recognize(dec.png, { langs: options.langs, orientation: 1, detectOrientation: options.detectOrientation, signal: deps.signal, onProgress, addToPdf: deps.searchablePdf });
        base.notes.push('Decoded by the app’s image decoder (the engine could not read this variant).');
      }
      if (deps.searchablePdf) pdf = await lease.pdfEnd({ signal: deps.signal });
    } finally {
      lease.release();
    }
    const pages = [pageFrom(0, out!)];
    const result: OcrResult = { ...base, pages, pageCount: 1, ...summarizePages(pages, 'image', 1), durationMs: Date.now() - started };
    return { result, pdf };
  }

  // ------------------------------------------------------------------ PDF
  if (st.size > OCR_LIMITS.maxPdfBytes) throw makeError('unsupported', op, { target: file, message: `PDFs over ${OCR_LIMITS.maxPdfBytes / 1024 / 1024} MB are not recognized.` });
  if (!deps.rasterizer) throw makeError('unavailable', op, { target: file, message: 'PDF pages can only be rendered for recognition inside the app.' });
  const bytes = await fsp.readFile(file);
  if (!bytes.subarray(0, 1024).toString('latin1').includes('%PDF-')) throw makeError('validation', op, { target: file, message: `“${path.basename(file)}” is not a PDF file.` });
  const doc = await deps.rasterizer.openPdf(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), deps.signal).catch((err) => {
    const e = toOrbisError(err, op, file);
    if (e.category === 'cancelled') throw err;
    throw makeError('validation', op, { target: file, message: /password/i.test(e.message) ? `“${path.basename(file)}” is password-protected; its pages cannot be rendered.` : `“${path.basename(file)}” could not be opened as a PDF (${e.message}).` });
  });
  let lease: OcrLease | undefined;
  try {
    const count = Math.min(doc.pageCount, OCR_LIMITS.maxPdfPages);
    if (doc.pageCount > count) base.notes.push(`Only the first ${count} of ${doc.pageCount} pages were recognized.`);
    // 1. Which pages already have text? (cheap: no rendering)
    const layers: RasterPage[] = [];
    for (let i = 0; i < count; i++) {
      await deps.gate?.();
      if (deps.signal?.aborted) throw makeError('cancelled', op);
      layers.push(await doc.page(i, { render: false, dpi: OCR_LIMITS.pdfDpi, maxPixels: OCR_LIMITS.pdfMaxPagePixels }, deps.signal));
      progress('Reading pages', (0.1 * (i + 1)) / count, i + 1, count);
    }
    const hasText = (l: RasterPage) => visibleChars(l.text) >= MIN_TEXT_LAYER_CHARS;
    const scanned = layers.every((l) => !hasText(l));
    let pdfSkipped: string | undefined;
    const makePdf = !!deps.searchablePdf && scanned;
    if (deps.searchablePdf && !scanned) pdfSkipped = 'This PDF already has text on some pages, so no searchable copy was made.';
    if (makePdf && doc.pageCount > count) pdfSkipped = `Only the first ${count} pages could be recognized, so no searchable copy was made.`;
    const pages: OcrPageResult[] = [];
    let pdf: Uint8Array | undefined;
    // 2. Recognize the pages that need it.
    for (let i = 0; i < count; i++) {
      await deps.gate?.();
      if (deps.signal?.aborted) throw makeError('cancelled', op);
      const layer = layers[i]!;
      const embeddedChars = visibleChars(layer.text);
      if (hasText(layer) && options.pdfTextPages === 'use-text') {
        pages.push({ index: i, source: 'pdf-text', text: layer.text.trim(), confidence: null, words: [], width: layer.width, height: layer.height, turn: 0, skew: 0, embeddedChars });
        continue;
      }
      const frac = (x: number) => 0.1 + (0.9 * (i + x)) / count;
      progress(`Recognizing page ${i + 1} of ${count}`, frac(0), i + 1, count);
      try {
        const rendered = await doc.page(i, { render: true, dpi: OCR_LIMITS.pdfDpi, maxPixels: OCR_LIMITS.pdfMaxPagePixels }, deps.signal);
        lease ??= await deps.engine.acquire(deps.lane, deps.signal);
        if (makePdf && i === 0 && !pdfSkipped) await lease.pdfBegin(path.basename(file), options.langs, { signal: deps.signal });
        const out = await lease.recognize(rendered.png!, { langs: options.langs, detectOrientation: options.detectOrientation, dpi: rendered.dpi, signal: deps.signal, onProgress: (f) => progress(`Recognizing page ${i + 1} of ${count}`, frac(f), i + 1, count), addToPdf: makePdf && !pdfSkipped });
        pages.push({ ...pageFrom(i, out), embeddedChars });
      } catch (err) {
        if (toOrbisError(err, op).category === 'cancelled') throw err;
        pages.push({ ...failedPage(i, err), embeddedChars });
        if (makePdf && !pdfSkipped) pdfSkipped = `Page ${i + 1} could not be recognized, so no searchable copy was made.`;
      }
    }
    if (makePdf && lease) {
      if (!pdfSkipped) pdf = await lease.pdfEnd({ signal: deps.signal });
      else await lease.pdfEnd({ signal: deps.signal }).catch(() => undefined);
    }
    const failed = pages.filter((p) => p.source === 'failed');
    if (failed.length) base.notes.push(`${failed.length} page${failed.length === 1 ? '' : 's'} could not be recognized: ${failed[0]!.error}`);
    if (failed.length === pages.length && pages.length) throw makeError('io', op, { target: file, message: failed[0]!.error ?? 'No page could be recognized.' });
    const result: OcrResult = { ...base, pages, pageCount: doc.pageCount, ...summarizePages(pages, 'pdf', doc.pageCount), durationMs: Date.now() - started };
    return { result, pdf, pdfSkipped };
  } finally {
    lease?.release();
    doc.close();
  }
}
