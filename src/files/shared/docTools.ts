import { z } from 'zod';

/**
 * Document tools shared by the main process and the UI: page-range parsing
 * for the PDF tools, the PDF operation request, and the text-fix options.
 * Everything here is pure (no file access), so the UI can validate what the
 * user types with exactly the rules the main process applies again.
 */

// ------------------------------------------------------------------ page ranges

/** One inclusive 1-based page range. */
export interface PageRange { from: number; to: number }

export type RangeParse = { ok: true; ranges: PageRange[] } | { ok: false; error: string };

/** Longest range text accepted. */
export const PAGE_RANGE_MAX_LENGTH = 2000;

/**
 * Parse page ranges such as "1-3, 5, 7-" against a document of `pageCount` pages.
 * Each comma-separated part is one range: "5" (one page), "1-3", "7-" (to the
 * last page) or "-4" (from the first page). Pages are 1-based. Errors say which
 * part is wrong and why; nothing is silently dropped or clamped.
 */
export function parsePageRanges(text: string, pageCount: number): RangeParse {
  const src = text.trim();
  if (!src) return { ok: false, error: 'Enter one or more pages, for example 1-3, 5, 7-.' };
  if (src.length > PAGE_RANGE_MAX_LENGTH) return { ok: false, error: `Page ranges are limited to ${PAGE_RANGE_MAX_LENGTH} characters.` };
  if (!Number.isInteger(pageCount) || pageCount < 1) return { ok: false, error: 'The document has no pages.' };
  const ranges: PageRange[] = [];
  for (const raw of src.split(/[,;]/)) {
    const part = raw.trim();
    if (!part) return { ok: false, error: 'There is an empty part between two commas.' };
    const m = /^(\d*)\s*(?:([-–])\s*(\d*))?$/.exec(part);
    if (!m || (!m[1] && !m[3])) return { ok: false, error: `“${part}” is not a page or a range. Use numbers such as 4, 2-6 or 7-.` };
    const dash = !!m[2];
    const from = m[1] ? Number(m[1]) : 1;
    const to = dash ? (m[3] ? Number(m[3]) : pageCount) : from;
    for (const n of [from, to]) {
      if (n < 1) return { ok: false, error: `“${part}”: pages start at 1.` };
      if (n > pageCount) return { ok: false, error: `“${part}”: the document has ${pageCount} page${pageCount === 1 ? '' : 's'}.` };
    }
    if (to < from) return { ok: false, error: `“${part}” runs backwards; write it as ${to}-${from}.` };
    ranges.push({ from, to });
  }
  return { ok: true, ranges };
}

/** The pages of the ranges, in the order written (0-based), duplicates kept. */
export function rangesToIndexes(ranges: PageRange[]): number[] {
  const out: number[] = [];
  for (const r of ranges) for (let p = r.from; p <= r.to; p++) out.push(p - 1);
  return out;
}

/** Short text for a list of 0-based page indexes: "1-3, 5". */
export function describePages(indexes: number[]): string {
  const sorted = [...new Set(indexes)].sort((a, b) => a - b).map((i) => i + 1);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!;
    let end = start;
    while (sorted[i + 1] === end + 1) end = sorted[++i]!;
    parts.push(start === end ? String(start) : `${start}-${end}`);
  }
  return parts.join(', ');
}

// ------------------------------------------------------------------ PDF operation

export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

const outName = z.string().trim().min(1).max(255);
const pdfPath = z.string().min(1).max(32767);

/** One page of a "pages" plan: which page of the source (0-based) and how much to turn it, in output order. */
export const PagePlanItemSchema = z.object({ page: z.number().int().min(0).max(1_000_000), rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]) });
export type PagePlanItem = z.infer<typeof PagePlanItemSchema>;

/**
 * What a 'pdf-tools' operation makes. Outputs are always new files in the
 * destination folder (an existing name gets " (2)", " (3)"…); sources are only read.
 *  - merge:   every source in the given order into one PDF;
 *  - split:   one source into one PDF per page, or one PDF per range;
 *  - extract: the pages of the ranges of one source into one PDF;
 *  - pages:   one source rebuilt from a page plan (delete, rotate, reorder).
 */
export const PdfJobSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('merge'), output: outName }),
  z.object({ action: z.literal('split'), mode: z.enum(['every', 'ranges']), ranges: z.string().max(PAGE_RANGE_MAX_LENGTH).optional(), baseName: outName }),
  z.object({ action: z.literal('extract'), ranges: z.string().min(1).max(PAGE_RANGE_MAX_LENGTH), output: outName }),
  z.object({ action: z.literal('pages'), plan: z.array(PagePlanItemSchema).min(1).max(100_000), output: outName }),
]);
export type PdfJob = z.infer<typeof PdfJobSchema>;

/** Output file name for a user-entered name: ".pdf" added when missing; path separators refused. */
export function pdfOutputName(name: string): { ok: true; name: string } | { ok: false; error: string } {
  const n = name.trim();
  if (!n) return { ok: false, error: 'Enter a name for the new PDF.' };
  if (/[\\/\0]/.test(n)) return { ok: false, error: 'The name cannot contain / or \\.' };
  if (n === '.' || n === '..') return { ok: false, error: 'Choose another name.' };
  const full = /\.pdf$/i.test(n) ? n : `${n}.pdf`;
  if (full.length > 255) return { ok: false, error: 'The name is too long.' };
  return { ok: true, name: full };
}

export const pdfPathSchema = pdfPath;

// ------------------------------------------------------------------ text fixes

/** Encodings the text fixes read. "auto" uses the BOM, the UTF-16 heuristic, then UTF-8 or Windows-1252. */
export const SOURCE_ENCODINGS = ['auto', 'utf8', 'utf16le', 'utf16be', 'latin1', 'windows1252'] as const;
export type SourceEncoding = (typeof SOURCE_ENCODINGS)[number];
export type TextEncodingName = Exclude<SourceEncoding, 'auto'>;

export const ENCODING_LABEL: Record<TextEncodingName, string> = {
  utf8: 'UTF-8',
  utf16le: 'UTF-16 LE',
  utf16be: 'UTF-16 BE',
  latin1: 'Latin-1 (ISO-8859-1)',
  windows1252: 'Windows-1252',
};

export const TextFixSpecSchema = z.object({
  /** Convert the text to UTF-8 (written without a BOM). */
  toUtf8: z.boolean(),
  /** How to read the file (auto = detected). */
  from: z.enum(SOURCE_ENCODINGS),
  lineEndings: z.enum(['keep', 'lf', 'crlf']),
  trimTrailing: z.boolean(),
  finalNewline: z.boolean(),
  /** Remove a UTF-8 byte-order mark (UTF-16 files keep theirs unless converted). */
  removeBom: z.boolean(),
});
export type TextFixSpec = z.infer<typeof TextFixSpecSchema>;

export const DEFAULT_TEXT_FIX: TextFixSpec = { toUtf8: false, from: 'auto', lineEndings: 'keep', trimTrailing: false, finalNewline: false, removeBom: false };

/** Preview of one file for the text fixes: what it is and what would change. */
export interface TextFixPreview {
  path: string;
  size: number;
  sha256?: string;
  /** Why the file is left alone (binary, too large, unreadable, cannot decode…). */
  refused?: string;
  encoding?: TextEncodingName;
  /** How the encoding was decided. */
  encodingSource?: 'bom' | 'detected' | 'chosen';
  bom?: boolean;
  lineEndings?: { lf: number; crlf: number; cr: number };
  trailingWhitespaceLines?: number;
  endsWithNewline?: boolean;
  /** The first characters as they will be read (to check the source encoding). */
  sample?: string;
  changes?: { converted: boolean; bomRemoved: boolean; lineEndingsChanged: number; linesTrimmed: number; finalNewlineAdded: boolean };
  /** Whether anything would change. */
  changed?: boolean;
  newSize?: number;
}
