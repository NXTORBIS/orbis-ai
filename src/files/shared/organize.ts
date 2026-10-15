import { z } from 'zod';

/**
 * Organize by date: folder patterns, their validation and rendering, the
 * request schema and the preview row type. Shared by the dialog (live
 * validation and the preview) and the main process (planning and the
 * 'organize-date' operation runner), so both apply exactly the same rules.
 */

export const ORGANIZE_TOKENS = ['YYYY', 'MM', 'MMMM', 'DD', 'camera', 'ext'] as const;
export type OrganizeToken = (typeof ORGANIZE_TOKENS)[number];

export const TOKEN_HELP: Record<OrganizeToken, string> = {
  YYYY: 'year, e.g. 2024',
  MM: 'month number, 01–12',
  MMMM: 'month name, e.g. March',
  DD: 'day of the month, 01–31',
  camera: 'camera make and model (“Unknown camera” when not recorded)',
  ext: 'file extension in lower case (“no extension” when there is none)',
};

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Photos: the date comes from EXIF DateTimeOriginal when the file has it. */
export const PHOTO_EXTS = new Set(['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'heic', 'heif', 'avif', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'dng', 'cr2', 'nef', 'arw', 'orf', 'rw2', 'raf']);
/** Videos: the date comes from the container's creation time when the file records one (MP4/QuickTime, Matroska/WebM). */
export const VIDEO_EXTS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ogv', '3gp', 'mts', 'm2ts']);

export const MAX_PATTERN_DEPTH = 6;
export const MAX_ORGANIZE_FILES = 50_000;

const FORBIDDEN_LITERAL = /[\\:*?"<>|\u0000-\u001f]/;

/** Why a pattern cannot be used, or undefined when it is fine. */
export function patternProblem(pattern: string): string | undefined {
  const p = pattern.trim();
  if (!p) return 'Enter a folder pattern, for example {YYYY}/{MM}.';
  if (p.length > 200) return 'The pattern is too long (200 characters at most).';
  if (p.startsWith('/')) return 'The pattern is relative to the destination folder; remove the leading “/”.';
  if (p.includes('\\')) return 'Separate folders with “/”.';
  const segments = p.replace(/\/+$/, '').split('/');
  if (segments.length > MAX_PATTERN_DEPTH) return `At most ${MAX_PATTERN_DEPTH} folder levels.`;
  for (const seg of segments) {
    if (!seg.trim()) return 'A folder level is empty (two “/” in a row).';
    if (seg.trim() === '.' || seg.trim() === '..') return '“.” and “..” cannot be used as folder names.';
    let literal = '';
    let last = 0;
    for (const m of seg.matchAll(/\{([^{}]*)\}/g)) {
      if (!(ORGANIZE_TOKENS as readonly string[]).includes(m[1]!)) return `Unknown token {${m[1]}}. Use ${ORGANIZE_TOKENS.map((t) => `{${t}}`).join(' ')}.`;
      literal += seg.slice(last, m.index);
      last = m.index! + m[0].length;
    }
    literal += seg.slice(last);
    if (literal.includes('{') || literal.includes('}')) return 'Braces must enclose a token, such as {YYYY}.';
    if (FORBIDDEN_LITERAL.test(literal)) return 'Folder names cannot contain \\ : * ? " < > | or control characters.';
  }
  return undefined;
}

export const OrganizePatternSchema = z.string().max(200).superRefine((s, ctx) => {
  const problem = patternProblem(s);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});

export const OrganizeSpecSchema = z.object({
  pattern: OrganizePatternSchema,
  /** Move the files, or put copies into the date folders and leave the originals. */
  mode: z.enum(['move', 'copy']),
  /** Photos and videos only, or every file. */
  include: z.enum(['media', 'all']),
  /** Selected folders: their files only, or every file below them. */
  recursive: z.boolean(),
  /** Files without a taken date (EXIF or video creation time): use the modification date, or leave them where they are. */
  withoutTakenDate: z.enum(['modified', 'skip']),
});
export type OrganizeSpec = z.infer<typeof OrganizeSpecSchema>;

export const DEFAULT_ORGANIZE_SPEC: OrganizeSpec = { pattern: '{YYYY}/{MM}', mode: 'move', include: 'media', recursive: false, withoutTakenDate: 'modified' };

export const OrganizePresetSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(80),
  pattern: OrganizePatternSchema,
  builtIn: z.boolean().optional(),
  savedMs: z.number().int().nonnegative().optional(),
});
export type OrganizePreset = z.infer<typeof OrganizePresetSchema>;

export const BUILTIN_ORGANIZE_PRESETS: OrganizePreset[] = [
  { id: 'builtin:year-month', name: 'Year / month', pattern: '{YYYY}/{MM}', builtIn: true },
  { id: 'builtin:year-day', name: 'Year / date', pattern: '{YYYY}/{YYYY}-{MM}-{DD}', builtIn: true },
  { id: 'builtin:year-monthname', name: 'Year / month name', pattern: '{YYYY}/{MM} {MMMM}', builtIn: true },
  { id: 'builtin:camera-year', name: 'Camera / year', pattern: '{camera}/{YYYY}', builtIn: true },
  { id: 'builtin:type-year', name: 'File type / year', pattern: '{ext}/{YYYY}', builtIn: true },
];

export type DateSource = 'exif' | 'video' | 'modified';

export const DATE_SOURCE_LABEL: Record<DateSource, string> = { exif: 'Taken (EXIF)', video: 'Recorded (video)', modified: 'Modified' };

export interface OrganizeFacts {
  year: number;
  month: number;
  day: number;
  camera?: string;
  ext: string;
}

/** Make a token value safe as (part of) one folder name. */
export function sanitizeValue(v: string): string {
  return v.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim();
}

/** The folder segments a pattern produces for one file. */
export function renderPattern(pattern: string, f: OrganizeFacts): string[] {
  const pad = (n: number) => String(n).padStart(2, '0');
  const values: Record<OrganizeToken, string> = {
    YYYY: String(f.year).padStart(4, '0'),
    MM: pad(f.month),
    MMMM: MONTH_NAMES[f.month - 1] ?? pad(f.month),
    DD: pad(f.day),
    camera: sanitizeValue(f.camera ?? '') || 'Unknown camera',
    ext: sanitizeValue(f.ext.toLowerCase()) || 'no extension',
  };
  return pattern.trim().replace(/\/+$/, '').split('/').map((seg) => {
    // Windows drops trailing dots and spaces from names; never produce them.
    const out = seg.replace(/\{([^{}]*)\}/g, (_m, name: string) => values[name as OrganizeToken] ?? '').trim().replace(/[. ]+$/, '');
    return out || '_';
  });
}

/** Year, month, day of an EXIF date ("YYYY-MM-DD HH:MM:SS" or "YYYY:MM:DD …"); undefined when not a real date. */
export function exifDateParts(s: string | undefined): { year: number; month: number; day: number } | undefined {
  if (!s) return undefined;
  const m = /^(\d{4})[-:](\d{2})[-:](\d{2})/.exec(s.trim());
  if (!m) return undefined;
  return validParts(Number(m[1]), Number(m[2]), Number(m[3]));
}

export function validParts(year: number, month: number, day: number): { year: number; month: number; day: number } | undefined {
  if (year < 1826 || year > 2200 || month < 1 || month > 12 || day < 1) return undefined;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > days) return undefined;
  return { year, month, day };
}

/** Local calendar date of a time in milliseconds. */
export function localParts(ms: number): { year: number; month: number; day: number } | undefined {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return undefined;
  return validParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** "Canon Canon EOS R6" → "Canon EOS R6": the make is dropped when the model repeats it. */
export function cameraName(make?: string, model?: string): string | undefined {
  const mk = (make ?? '').trim();
  const md = (model ?? '').trim();
  if (!mk && !md) return undefined;
  if (!md) return mk;
  if (!mk || md.toLowerCase().startsWith(mk.toLowerCase().split(/\s+/)[0]!)) return md;
  return `${mk} ${md}`;
}

export function mediaKindOf(ext: string): 'photo' | 'video' | 'other' {
  const e = ext.toLowerCase();
  return PHOTO_EXTS.has(e) ? 'photo' : VIDEO_EXTS.has(e) ? 'video' : 'other';
}

/** One row of the preview (and of the runner's own plan). */
export interface OrganizeItem {
  source: string;
  name: string;
  kind: 'photo' | 'video' | 'other';
  /** YYYY-MM-DD used for the folders. */
  date?: string;
  dateSource?: DateSource;
  camera?: string;
  /** Folder the file goes into (absolute). */
  targetDir?: string;
  /** Full planned path (absolute). */
  target?: string;
  /** What will happen: moved/copied, or left alone (with the reason). */
  action: 'move' | 'copy' | 'skip';
  reason?: string;
  /** exists: something is already at the target; duplicate: an earlier file in this plan goes to the same place. Both are asked about (keep both or skip). */
  conflict?: 'exists' | 'duplicate';
}

export interface OrganizePlan {
  items: OrganizeItem[];
  /** Files left out while collecting (links, special files, hidden files, other types). */
  ignored: number;
  /** New folders the run would create (relative to the destination). */
  newFolders: string[];
  truncated: boolean;
}
