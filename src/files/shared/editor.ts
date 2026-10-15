import { z } from 'zod';
import { SOURCE_ENCODINGS, type TextEncodingName } from './docTools';

/**
 * Built-in text editor: limits, request schemas and the pure helpers shared by
 * the main process (reading, saving) and the window (status bar, language
 * modes, indentation). Nothing here touches files.
 *
 * Text crosses the IPC boundary with LF line endings only; the file's own line
 * endings (and encoding, and byte-order mark) travel beside it and are applied
 * again when saving, so an unchanged document saves byte for byte as it was.
 */

/** Largest file the editor opens (bytes). Larger files are offered to the default app instead. */
export const EDITOR_MAX_BYTES = 5 * 1024 * 1024;
/** Longest text accepted for saving (characters); the encoded result is checked again in the main process. */
export const EDITOR_MAX_CHARS = 16 * 1024 * 1024;
/** Largest encoded file the editor writes (bytes). */
export const EDITOR_MAX_WRITE_BYTES = 48 * 1024 * 1024;

export type EolKind = 'lf' | 'crlf' | 'cr';
export const EOL_LABEL: Record<EolKind, string> = { lf: 'LF', crlf: 'CRLF', cr: 'CR' };
export const EOL_TEXT: Record<EolKind, string> = { lf: '\n', crlf: '\r\n', cr: '\r' };

const EDITOR_ENCODINGS = SOURCE_ENCODINGS.filter((e): e is TextEncodingName => e !== 'auto');
export const EditorEncodingSchema = z.enum(EDITOR_ENCODINGS as [TextEncodingName, ...TextEncodingName[]]);

/** What the editor loaded: the file's size, modification time and SHA-256, compared again before saving. */
export interface EditorStamp { size: number; mtimeMs: number; sha256: string }
export const EditorStampSchema = z.object({ size: z.number().int().nonnegative(), mtimeMs: z.number().nonnegative(), sha256: z.string().regex(/^[0-9a-f]{64}$/) });

export interface EditorDoc {
  /** The file being edited (when opened through a symbolic link, the file the link points to). */
  path: string;
  /** The path that was asked for (differs from `path` for links). */
  requestedPath: string;
  name: string;
  /** Contents with LF line endings. */
  text: string;
  encoding: TextEncodingName;
  /** How the encoding was found: a byte-order mark, by looking at the bytes, or chosen by the user ("Reopen with encoding"). */
  encodingSource: 'bom' | 'detected' | 'chosen';
  bom: boolean;
  /** The line ending used most (LF when the file has no line breaks). */
  eol: EolKind;
  /** The file mixes line endings; saving writes `eol` everywhere. */
  mixedEol: boolean;
  stamp: EditorStamp;
  readOnly: boolean;
  readOnlyReason?: string;
}

export type EditorRefusal = 'binary' | 'too-large' | 'not-file' | 'not-text';

export type EditorOpenResult =
  | { status: 'ok'; doc: EditorDoc }
  | { status: 'refused'; reason: EditorRefusal; message: string; path: string; size?: number };

export type EditorSaveResult =
  /** Written; `stamp` describes the new file, `snapshotId` the earlier version kept (when one was replaced). */
  | { status: 'saved'; path: string; stamp: EditorStamp; snapshotId?: string; readOnly: boolean; readOnlyReason?: string }
  /** The file is not what the editor loaded (null: it is gone). Nothing was written. */
  | { status: 'conflict'; current: EditorStamp | null }
  /** Save as: something already has that name. Nothing was written. */
  | { status: 'exists'; path: string; current: EditorStamp | null };

const pathStr = z.string().min(1).max(32767);
/** How the text is written: encoding, byte-order mark and line endings. */
export const EditorWriteSchema = z.object({
  text: z.string().max(EDITOR_MAX_CHARS),
  encoding: EditorEncodingSchema,
  bom: z.boolean(),
  eol: z.enum(['lf', 'crlf', 'cr']),
});
export type EditorWrite = z.infer<typeof EditorWriteSchema>;

export const EditorSaveSchema = EditorWriteSchema.extend({
  path: pathStr,
  /** What the editor loaded or last saved; null means the file is expected not to exist (recreating a deleted file). */
  expected: EditorStampSchema.nullable(),
});
export const EditorSaveAsSchema = EditorWriteSchema.extend({
  dir: pathStr,
  name: z.string().min(1).max(255),
  /** Replace an existing file: the stamp the user agreed to replace (it must still match). */
  replace: EditorStampSchema.optional(),
});
export const EditorSaveCopySchema = EditorWriteSchema.extend({ path: pathStr });
export const EditorDiffSchema = z.object({ path: pathStr, text: z.string().max(EDITOR_MAX_CHARS) });

// ------------------------------------------------------------------ line endings

export function countEols(text: string): { lf: number; crlf: number; cr: number } {
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

/** The dominant line ending (LF when there are none, and on ties LF before CRLF before CR) and whether several kinds occur. */
export function detectEol(text: string): { eol: EolKind; mixed: boolean } {
  const n = countEols(text);
  const kinds = [n.lf, n.crlf, n.cr].filter((x) => x > 0).length;
  const eol: EolKind = n.crlf > n.lf && n.crlf >= n.cr ? 'crlf' : n.cr > n.lf && n.cr > n.crlf ? 'cr' : 'lf';
  return { eol, mixed: kinds > 1 };
}

export const toLf = (text: string): string => text.replace(/\r\n?/g, '\n');
export const fromLf = (text: string, eol: EolKind): string => (eol === 'lf' ? text : text.replace(/\n/g, EOL_TEXT[eol]));

// ------------------------------------------------------------------ languages (kept free of zod: the editor bundle uses them)
export { EDITOR_LANGUAGES, languageById, languageForName, countsWords, type EditorLanguage } from './editorLanguages';

/**
 * Extensions that are certainly not text (media, archives, documents with
 * their own format). Used only to decide whether to offer "Edit" in menus;
 * the main process decides from the file's bytes when it is opened.
 */
const NOT_TEXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif', 'ico', 'raw', 'cr2', 'nef', 'arw', 'dng', 'psd',
  'mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg', '3gp', 'ogv', 'mp3', 'wav', 'flac', 'aac', 'ogg', 'oga', 'm4a', 'opus', 'wma', 'aiff', 'aif',
  'pdf', 'doc', 'docx', 'odt', 'rtf', 'pages', 'epub', 'xls', 'xlsx', 'ods', 'numbers', 'ppt', 'pptx', 'odp', 'key',
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'zst', 'tbz2', 'txz', 'iso', 'dmg', 'deb', 'rpm', 'appimage', 'jar', 'apk',
  'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'class', 'pyc', 'wasm', 'db', 'sqlite', 'orbisenc', 'ttf', 'otf', 'woff', 'woff2',
]);
export const mayBeText = (fileName: string): boolean => {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 || !NOT_TEXT.has(fileName.slice(dot + 1).toLowerCase());
};

// ------------------------------------------------------------------ indentation and counts

/**
 * Guess the indentation of a document: tabs when more indented lines start
 * with a tab, otherwise the most common step between the space indents of
 * consecutive lines (2, 3, 4 or 8). Defaults to 4 spaces when nothing is indented.
 */
export function detectIndent(text: string, maxLines = 5000): { useTabs: boolean; size: number } {
  let tabs = 0;
  let spaces = 0;
  const steps = new Map<number, number>();
  let prev = 0;
  let lines = 0;
  let start = 0;
  while (start <= text.length && lines < maxLines) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end);
    start = end + 1;
    lines++;
    if (!line.trim()) continue;
    if (line[0] === '\t') {
      tabs++;
      prev = 0;
      continue;
    }
    const m = /^ +/.exec(line);
    const n = m ? m[0].length : 0;
    if (n) spaces++;
    const d = Math.abs(n - prev);
    if (d >= 2 && d <= 8) steps.set(d, (steps.get(d) ?? 0) + 1);
    prev = n;
  }
  if (tabs > spaces) return { useTabs: true, size: 4 };
  let best = 4;
  let bestCount = 0;
  for (const size of [2, 4, 3, 8]) {
    const c = steps.get(size) ?? 0;
    if (c > bestCount) {
      best = size;
      bestCount = c;
    }
  }
  return { useTabs: false, size: best };
}

/** Words (letters or digits, with inner apostrophes and hyphens) and characters (code points, line breaks excluded). */
export function countWords(text: string): { words: number; chars: number } {
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu)?.length ?? 0;
  let chars = 0;
  for (const ch of text) if (ch !== '\n' && ch !== '\r') chars++;
  return { words, chars };
}

/** "Name (copy).ext" for keeping the editor's version beside a file another program changed. */
export function copyName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? `${fileName.slice(0, dot)} (copy)${fileName.slice(dot)}` : `${fileName} (copy)`;
}
