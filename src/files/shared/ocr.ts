import { z } from 'zod';

/**
 * Text recognition (OCR): types, limits and pure helpers shared by the main
 * process (engine, operations, background job) and the window (panel, dialogs).
 * Recognition itself runs offline in a worker thread (tesseract.js's WebAssembly
 * core); nothing here touches the network.
 */

/**
 * Image formats the engine reads itself (Leptonica inside the WebAssembly core),
 * checked by the tests: PNG, JPEG, WebP, BMP, GIF (first frame) and TIFF (first
 * page; baseline RGB, LZW and CCITT G4 — some compressed grey-scale TIFFs are
 * refused by the decoder and reported as such).
 */
export const OCR_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'jpe', 'jfif', 'webp', 'bmp', 'gif', 'tif', 'tiff'] as const;
const IMAGE_SET = new Set<string>(OCR_IMAGE_EXTS);

export type OcrFileKind = 'image' | 'pdf';

/** Whether a file name is something text can be recognized in (by extension; contents are checked when read). */
export function ocrKindOf(name: string): OcrFileKind | undefined {
  const i = name.lastIndexOf('.');
  if (i <= 0) return undefined;
  const ext = name.slice(i + 1).toLowerCase();
  if (ext === 'pdf') return 'pdf';
  return IMAGE_SET.has(ext) ? 'image' : undefined;
}

/** Traineddata language codes: "eng", "chi_sim", "deu_latf", script models such as "Latin". */
export const LANG_CODE_RE = /^[A-Za-z][A-Za-z0-9_]{1,39}$/;
export const OcrLangSchema = z.string().regex(LANG_CODE_RE, 'Not a valid language code.');
export const OcrLangsSchema = z
  .array(OcrLangSchema)
  .min(1, 'Choose at least one language.')
  .max(6, 'Choose at most six languages at once.')
  .refine((l) => new Set(l).size === l.length, 'A language is listed twice.');

/** The bundled language (English, "best int" LSTM model). */
export const BUNDLED_LANGS = ['eng'] as const;

/** Readable names for common traineddata codes (others are shown by their code). */
export const LANG_NAMES: Record<string, string> = {
  eng: 'English', deu: 'German', fra: 'French', spa: 'Spanish', ita: 'Italian', por: 'Portuguese', nld: 'Dutch', swe: 'Swedish',
  dan: 'Danish', nor: 'Norwegian', fin: 'Finnish', pol: 'Polish', ces: 'Czech', slk: 'Slovak', hun: 'Hungarian', ron: 'Romanian',
  tur: 'Turkish', ell: 'Greek', rus: 'Russian', ukr: 'Ukrainian', bul: 'Bulgarian', srp: 'Serbian', hrv: 'Croatian', slv: 'Slovenian',
  lit: 'Lithuanian', lav: 'Latvian', est: 'Estonian', cat: 'Catalan', eus: 'Basque', glg: 'Galician', isl: 'Icelandic', gle: 'Irish',
  ara: 'Arabic', heb: 'Hebrew', fas: 'Persian', hin: 'Hindi', ben: 'Bengali', tha: 'Thai', vie: 'Vietnamese', ind: 'Indonesian',
  msa: 'Malay', jpn: 'Japanese', kor: 'Korean', chi_sim: 'Chinese (simplified)', chi_tra: 'Chinese (traditional)', lat: 'Latin',
  deu_latf: 'German (Fraktur)', osd: 'Orientation and script detection',
};
export const langName = (code: string): string => LANG_NAMES[code] ?? code;

/** Options of one recognition run (a file in the panel, or every file of a batch). */
export const OcrRunOptionsSchema = z.object({
  langs: OcrLangsSchema,
  /** Try the other three orientations when the result is poor (sideways or upside-down scans). */
  detectOrientation: z.boolean().default(true),
  /** PDF pages that already carry text: use that text (default), or recognize the rendered page anyway. */
  pdfTextPages: z.enum(['use-text', 'recognize']).default('use-text'),
});
export type OcrRunOptions = z.infer<typeof OcrRunOptionsSchema>;
export const DEFAULT_RUN_OPTIONS: OcrRunOptions = { langs: ['eng'], detectOrientation: true, pdfTextPages: 'use-text' };

/** Limits. Interactive runs (the panel, batches) and the background job have their own. */
export const OCR_LIMITS = {
  /** Largest image file read for recognition. */
  maxImageBytes: 100 * 1024 * 1024,
  /** Largest image (pixels) handed to the engine; larger ones are refused with the reason. */
  maxMegapixels: 60,
  /** Largest PDF opened for recognition (it is read into memory). */
  maxPdfBytes: 200 * 1024 * 1024,
  /** Pages recognized per PDF (later pages are reported as not recognized). */
  maxPdfPages: 200,
  /** Resolution PDF pages are rendered at for recognition, and the pixel cap per rendered page. */
  pdfDpi: 200,
  pdfMaxPagePixels: 25_000_000,
  /** One page may take this long before its worker is stopped (ms). */
  pageTimeoutMs: 120_000,
  /** Text saved from the panel (characters). */
  maxSavedText: 10_000_000,
} as const;

/** Mean confidence below which a result is flagged as unreliable. */
export const LOW_CONFIDENCE = 60;

export interface OcrWord {
  text: string;
  /** Tesseract's word confidence, 0–100. */
  conf: number;
  /** Box in the recognized frame (pixels): see `OcrPageResult.turn`. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type QuarterTurn = 0 | 90 | 180 | 270;

export interface OcrPageResult {
  /** 0-based page index (0 for images). */
  index: number;
  /** 'ocr': recognized; 'pdf-text': the PDF page's own text layer was used; 'failed': see `error`. */
  source: 'ocr' | 'pdf-text' | 'failed';
  text: string;
  /** Mean word confidence (0–100) for recognized pages; null when nothing was recognized or for 'pdf-text'. */
  confidence: number | null;
  words: OcrWord[];
  /** Size of the recognized frame in pixels (after `turn`). */
  width: number;
  height: number;
  /** Clockwise quarter turns applied to the image as shown before recognition (orientation detection). */
  turn: QuarterTurn;
  /** Small skew (radians) the engine straightened before recognizing. */
  skew: number;
  /** PDF: characters in the page's own text layer. */
  embeddedChars?: number;
  error?: string;
}

export interface OcrResult {
  path: string;
  kind: OcrFileKind;
  size: number;
  mtimeMs: number;
  langs: string[];
  pages: OcrPageResult[];
  /** Pages in the document (PDF); 1 for images. */
  pageCount: number;
  /** All text, pages separated by a "--- Page n ---" line for multi-page PDFs. */
  text: string;
  /** Mean confidence over recognized words (weighted by length); null when nothing was recognized. */
  confidence: number | null;
  lowConfidence: boolean;
  /** PDF: whether its pages are scans (no text layer), already have text, or both. */
  pdfKind?: 'scanned' | 'has-text' | 'mixed';
  notes: string[];
  durationMs: number;
}

/** Mean word confidence weighted by word length (long words count more than stray marks). */
export function meanConfidence(words: Array<{ text: string; conf: number }>): number | null {
  let sum = 0;
  let weight = 0;
  for (const w of words) {
    const n = Math.max(1, Math.min(20, w.text.trim().length));
    if (!w.text.trim()) continue;
    sum += Math.max(0, Math.min(100, w.conf)) * n;
    weight += n;
  }
  return weight ? Math.round((sum / weight) * 10) / 10 : null;
}

/** "High", "Medium" or "Low" for a confidence (null: nothing recognized). */
export function confidenceLabel(c: number | null): 'High' | 'Medium' | 'Low' | 'None' {
  if (c === null) return 'None';
  return c >= 85 ? 'High' : c >= LOW_CONFIDENCE ? 'Medium' : 'Low';
}

/** Combine page results into the result's text, confidence and flags. */
export function summarizePages(pages: OcrPageResult[], kind: OcrFileKind, pageCount: number): Pick<OcrResult, 'text' | 'confidence' | 'lowConfidence' | 'pdfKind'> {
  const multi = kind === 'pdf' && pageCount > 1;
  const text = pages
    .filter((p) => p.source !== 'failed')
    .map((p) => (multi ? `--- Page ${p.index + 1} ---\n${p.text.trim()}` : p.text.trim()))
    .join('\n\n')
    .trim();
  const words = pages.filter((p) => p.source === 'ocr').flatMap((p) => p.words);
  const confidence = meanConfidence(words);
  const lowConfidence = confidence !== null && confidence < LOW_CONFIDENCE;
  let pdfKind: OcrResult['pdfKind'];
  if (kind === 'pdf') {
    const withText = pages.filter((p) => (p.embeddedChars ?? 0) >= MIN_TEXT_LAYER_CHARS).length;
    pdfKind = withText === 0 ? 'scanned' : withText === pages.length ? 'has-text' : 'mixed';
  }
  return { text, confidence, lowConfidence, pdfKind };
}

/** A PDF page with at least this many non-space characters in its text layer "already has text". */
export const MIN_TEXT_LAYER_CHARS = 20;

/** Characters that are not white space. */
export const visibleChars = (s: string): number => s.replace(/\s+/g, '').length;

// ------------------------------------------------------------------ geometry

/**
 * Map a word box from the recognized frame back to the image as shown (after
 * its EXIF orientation), given the recognized frame's size and the clockwise
 * quarter turn that was applied before recognition.
 */
export function boxToShown(b: { x0: number; y0: number; x1: number; y1: number }, turn: QuarterTurn, frame: { width: number; height: number }): { x0: number; y0: number; x1: number; y1: number } {
  const { width: w, height: h } = frame;
  switch (turn) {
    case 90: return { x0: b.y0, y0: w - b.x1, x1: b.y1, y1: w - b.x0 };
    case 180: return { x0: w - b.x1, y0: h - b.y1, x1: w - b.x0, y1: h - b.y0 };
    case 270: return { x0: h - b.y1, y0: b.x0, x1: h - b.y0, y1: b.x1 };
    default: return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
  }
}

/** Size of the image as shown, from the recognized frame and the turn. */
export function shownSize(frame: { width: number; height: number }, turn: QuarterTurn): { width: number; height: number } {
  return turn === 90 || turn === 270 ? { width: frame.height, height: frame.width } : { width: frame.width, height: frame.height };
}

/**
 * EXIF orientation value that applies the file's own orientation and then
 * `turn` more clockwise (the engine reads the image through it).
 * Orientations 2/7/4/5 are "mirror, then rotate 0/90/180/270 clockwise".
 */
export function composeOrientation(fileOrientation: number | undefined, turn: QuarterTurn): number {
  const plain: Record<number, number> = { 1: 0, 6: 1, 3: 2, 8: 3 };
  const mirrored: Record<number, number> = { 2: 0, 7: 1, 4: 2, 5: 3 };
  const o = fileOrientation && fileOrientation >= 1 && fileOrientation <= 8 ? fileOrientation : 1;
  const isMirrored = o in mirrored;
  const r = ((isMirrored ? mirrored[o]! : plain[o]!) + turn / 90) % 4;
  return isMirrored ? [2, 7, 4, 5][r]! : [1, 6, 3, 8][r]!;
}

// ------------------------------------------------------------------ names and output

const stemOf = (name: string): string => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
};

/** "scan.png" → "scan.txt" (a free name is chosen when it is taken). */
export const textOutputName = (sourceName: string): string => `${stemOf(sourceName)}.txt`;
/** "scan.pdf" → "scan (OCR).pdf"; "photo.jpg" → "photo (OCR).pdf". */
export const searchablePdfName = (sourceName: string): string => `${stemOf(sourceName)} (OCR).pdf`;
export const DEFAULT_MARKDOWN_NAME = 'Extracted text.md';

/** A Markdown name chosen in the batch dialog: one plain file name ending in .md. */
export function markdownOutputName(input: string): { ok: true; name: string } | { ok: false; error: string } {
  let n = input.trim();
  if (!n) return { ok: false, error: 'Enter a file name.' };
  if (!/\.md$/i.test(n)) n += '.md';
  if (/[\\/]/.test(n) || n.includes('\0') || n === '.md' || n.startsWith('.') || n.length > 200) return { ok: false, error: 'Use a plain file name (no folders), up to 200 characters.' };
  if (/[<>:"|?*]/.test(n)) return { ok: false, error: 'File names cannot contain < > : " | ? *.' };
  return { ok: true, name: n };
}

/** A fence that no line of `text` can close early. */
function fenceFor(text: string): string {
  let longest = 2;
  for (const m of text.matchAll(/`{3,}/g)) longest = Math.max(longest, m[0].length);
  return '`'.repeat(longest + 1);
}

/** Heading text with Markdown's own characters escaped. */
const escapeHeading = (s: string): string => s.replace(/[\\`*_[\]#<>]/g, (c) => `\\${c}`).replace(/\s+/g, ' ');

/** One combined Markdown document: a heading per file, then its text in a fenced block (kept exactly). */
export function markdownDocument(items: Array<{ label: string; result?: Pick<OcrResult, 'text' | 'confidence' | 'lowConfidence' | 'pdfKind' | 'pageCount' | 'kind' | 'langs'>; error?: string }>, createdMs: number): string {
  const out: string[] = ['# Extracted text', '', `Recognized by Orbis Files on ${new Date(createdMs).toISOString().slice(0, 10)} from ${items.length} file${items.length === 1 ? '' : 's'}.`, ''];
  for (const it of items) {
    out.push(`## ${escapeHeading(it.label)}`, '');
    if (it.error || !it.result) {
      out.push(`_Not recognized: ${escapeHeading(it.error ?? 'unknown error')}_`, '');
      continue;
    }
    const r = it.result;
    const facts = [
      r.kind === 'pdf' ? `${r.pageCount} page${r.pageCount === 1 ? '' : 's'}${r.pdfKind === 'has-text' ? ', text taken from the PDF' : r.pdfKind === 'mixed' ? ', some pages scanned' : ', scanned'}` : 'image',
      r.confidence === null ? 'no recognized words' : `confidence ${Math.round(r.confidence)}%${r.lowConfidence ? ' (low: check the text)' : ''}`,
      r.langs.map(langName).join(' + '),
    ];
    out.push(`_${facts.join(' · ')}_`, '');
    if (!r.text.trim()) {
      out.push('_No text was found._', '');
      continue;
    }
    const fence = fenceFor(r.text);
    out.push(`${fence}text`, r.text.replace(/\r\n?/g, '\n').trimEnd(), fence, '');
  }
  return out.join('\n');
}

/** A short excerpt of `text` around the first match of `needle` (case-insensitive), white space collapsed. */
export function snippetAround(text: string, needle: string, radius = 48): string | undefined {
  const flat = text.replace(/\s+/g, ' ').trim();
  const i = needle ? flat.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (i < 0) return flat ? flat.slice(0, radius * 2) + (flat.length > radius * 2 ? '…' : '') : undefined;
  const start = Math.max(0, i - radius);
  const end = Math.min(flat.length, i + needle.length + radius);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

// ------------------------------------------------------------------ operations and settings

/** "Extract text to files" (operation 'ocr-extract'). */
export const OcrExtractParamsSchema = z.object({
  /** A .txt next to each file, or one Markdown file (in the operation's destination) with a heading per file. */
  output: z.enum(['txt', 'markdown']),
  markdownName: z.string().max(200).optional(),
  /** Also save "<name> (OCR).pdf" with a text layer for images and scanned PDFs. */
  searchablePdf: z.boolean().default(false),
  /** Folders: also files in folders inside them. */
  includeSubfolders: z.boolean().default(false),
  options: OcrRunOptionsSchema,
});
export type OcrExtractParams = z.infer<typeof OcrExtractParamsSchema>;

/** "Save as .txt" from the panel (operation 'ocr-save'): the recognized text, saved next to the file. */
export const OcrSaveParamsSchema = z.object({ text: z.string().max(OCR_LIMITS.maxSavedText) });

/** Most files one batch accepts after folders are expanded. */
export const OCR_BATCH_MAX_FILES = 5000;

/** "Make text in images searchable" (Settings → Text recognition). Stored per profile. */
export const OcrIndexSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Folders whose images are recognized (with their subfolders). Default: Pictures and Documents. */
  folders: z.array(z.string().min(1).max(4096)).max(32).default([]),
  /** Images larger than this are skipped (MB). */
  maxFileMB: z.number().int().min(1).max(200).default(20),
  /** Images with more pixels than this are skipped (megapixels). */
  maxMegapixels: z.number().int().min(1).max(100).default(30),
  /** Worker threads used by the background job (each holds its own engine and language data). */
  workers: z.union([z.literal(1), z.literal(2)]).default(1),
  langs: OcrLangsSchema.default(['eng']),
});
export type OcrIndexSettings = z.infer<typeof OcrIndexSettingsSchema>;

export interface OcrIndexStatus {
  settings: OcrIndexSettings;
  state: 'off' | 'idle' | 'scanning' | 'paused';
  /** The folder being checked now. */
  current?: string;
  /** Files looked at and images recognized in the current (or last) run. */
  checked: number;
  recognized: number;
  /** Images waiting for recognition in the current run. */
  pending: number;
  skipped: number;
  failed: number;
  /** Images whose text is stored now. */
  stored: number;
  lastRunMs?: number;
  lastError?: string;
  /** How the worker's priority is lowered on this platform. */
  priority: 'lowered' | 'normal';
  priorityNote: string;
}

/** IPC payloads (validated in the main process before anything runs). */
const pathStr = z.string().min(1).max(32767);
export const OCR_INVOKE_SCHEMAS = {
  /** Recognize one image or PDF as a cancellable job (job:progress / job:done); the result is returned, nothing is written. */
  'ocr:recognize': z.object({ path: pathStr, jobId: z.string().min(1).max(128), options: OcrRunOptionsSchema }),
  'ocr:capabilities': z.object({}),
  'ocr:languages': z.object({}),
  /** Copy a .traineddata file the user chose into the profile (validated; never downloaded). */
  'ocr:addLanguage': z.object({ path: pathStr }),
  'ocr:removeLanguage': z.object({ code: OcrLangSchema }),
  /** Native file dialog filtered to .traineddata files. */
  'ocr:pickLanguageFile': z.object({}),
  'ocr:indexStatus': z.object({}),
  'ocr:indexSettings': OcrIndexSettingsSchema.partial(),
  'ocr:indexRun': z.object({}),
  'ocr:indexPause': z.object({}),
  'ocr:indexResume': z.object({}),
  'ocr:indexCancel': z.object({}),
} as const;
export const OCR_EVENT_CHANNELS = ['ocr:indexStatus', 'ocr:languagesChanged'] as const;

export interface OcrLanguageInfo {
  code: string;
  name: string;
  source: 'bundled' | 'added';
  bytes: number;
}

export interface OcrCapabilities {
  formats: string[];
  /** PDF pages can be rendered for recognition (needs the app's renderer; false in a bare Node process). */
  pdf: boolean;
  searchablePdf: boolean;
  languages: OcrLanguageInfo[];
  priority: OcrIndexStatus['priority'];
  priorityNote: string;
}
