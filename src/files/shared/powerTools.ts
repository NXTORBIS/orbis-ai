import { z } from 'zod';

/**
 * Power tools shared by the main process and the window: split and join,
 * secure delete ("shred"), flatten folder, set dates, hard links and the
 * clipboard helpers. Planning rules live here so the dialogs and the
 * operation runners apply exactly the same checks.
 */

const pathStr = z.string().min(1).max(32767);
const nameStr = z.string().min(1).max(1024);
const idStr = z.string().min(1).max(128);
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const byteCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** Operation type labels (Operations panel, notifications). */
export const POWER_OPERATION_LABELS: Record<string, string> = {
  'split-file': 'Split file',
  'join-files': 'Join files',
  shred: 'Secure delete',
  flatten: 'Flatten folder',
  'flatten-restore': 'Undo flatten',
  'set-dates': 'Set dates',
  'link-create': 'Create links',
  'clip-save': 'Paste as file',
};

// ------------------------------------------------------------------ split and join

export const KiB = 1024;
export const MiB = 1024 * 1024;
export const GiB = 1024 * 1024 * 1024;

/** Part-size presets. "MB" means MiB (as 7-Zip and HJSplit count); the exact byte count is shown beside it. */
export const SPLIT_PRESETS = [
  { id: '100m', label: '100 MB', bytes: 100 * MiB },
  { id: '700m', label: '700 MB (CD)', bytes: 700 * MiB },
  { id: 'fat32', label: '4 GB − 1 byte (FAT32 limit)', bytes: 4 * GiB - 1 },
] as const;

export const MAX_SPLIT_PARTS = 9999;
export const DESCRIPTOR_SUFFIX = '.orbis-split.json';

export const SplitParamsSchema = z.object({
  mode: z.enum(['size', 'count']),
  partBytes: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  parts: z.number().int().min(2).max(MAX_SPLIT_PARTS).optional(),
  /** Write `<name>.orbis-split.json` with the SHA-256 of every part and of the whole file. */
  descriptor: z.boolean(),
}).refine((p) => (p.mode === 'size' ? p.partBytes !== undefined : p.parts !== undefined), 'Choose a part size or a number of parts.');
export type SplitParams = z.infer<typeof SplitParamsSchema>;

export interface SplitPlan {
  partBytes: number;
  parts: number;
  lastBytes: number;
}

/** Part size and count for a file, or why it cannot be split that way. */
export function planSplit(size: number, p: Pick<SplitParams, 'mode' | 'partBytes' | 'parts'>): SplitPlan | { error: string } {
  if (!Number.isFinite(size) || size <= 0) return { error: 'The file is empty, so there is nothing to split.' };
  let partBytes: number;
  if (p.mode === 'size') {
    partBytes = Math.floor(p.partBytes ?? 0);
    if (partBytes < 1) return { error: 'Enter a part size of at least 1 byte.' };
  } else {
    const n = Math.floor(p.parts ?? 0);
    if (n < 2) return { error: 'Split into at least 2 parts.' };
    if (n > MAX_SPLIT_PARTS) return { error: `At most ${MAX_SPLIT_PARTS.toLocaleString('en')} parts.` };
    if (size < n) return { error: `The file has only ${size} byte${size === 1 ? '' : 's'}, fewer than ${n} parts.` };
    partBytes = Math.ceil(size / n);
  }
  const parts = Math.ceil(size / partBytes);
  if (parts < 2) return { error: 'The file is not larger than one part, so there is nothing to split. Choose a smaller part size.' };
  if (parts > MAX_SPLIT_PARTS) return { error: `That would make ${parts.toLocaleString('en')} parts; at most ${MAX_SPLIT_PARTS.toLocaleString('en')} are made. Choose a larger part size.` };
  return { partBytes, parts, lastBytes: size - partBytes * (parts - 1) };
}

/** ".001" … with at least three digits (more for 1,000 parts or more). */
export function partSuffix(index: number, total: number): string {
  return String(index).padStart(Math.max(3, String(total).length), '0');
}

export function partName(base: string, index: number, total: number): string {
  return `${base}.${partSuffix(index, total)}`;
}

export const SplitDescriptorSchema = z.object({
  format: z.literal('orbis-split'),
  version: z.literal(1),
  name: nameStr,
  size: byteCount,
  sha256: hex64,
  partBytes: z.number().int().min(1),
  parts: z.array(z.object({ name: nameStr, size: byteCount, sha256: hex64 })).min(1).max(MAX_SPLIT_PARTS),
  createdMs: z.number().int().nonnegative(),
});
export type SplitDescriptor = z.infer<typeof SplitDescriptorSchema>;

/** "movie.mkv.003" → base "movie.mkv", index 3, width 3. Needs at least three digits (7-Zip, HJSplit). */
export function parsePartName(name: string): { base: string; index: number; width: number } | undefined {
  const m = /^(.+)\.(\d{3,5})$/.exec(name);
  if (!m || !m[1]) return undefined;
  return { base: m[1], index: Number(m[2]), width: m[2]!.length };
}

export interface PartSequence {
  base: string;
  width: number;
  /** First index of the sequence (1, or 0 when a .000 part exists). */
  first: number;
  present: Array<{ index: number; name: string }>;
  /** Part numbers between the first and the last (or the count the descriptor names) that are not there. */
  missing: number[];
}

/** The sequence a part belongs to, among the names in its folder. */
export function findSequence(names: string[], picked: string, expectedParts?: number): PartSequence | undefined {
  const p = parsePartName(picked);
  if (!p) return undefined;
  const present = names
    .map((n) => ({ n, q: parsePartName(n) }))
    .filter((x) => x.q && x.q.base === p.base && x.q.width === p.width)
    .map((x) => ({ index: x.q!.index, name: x.n }))
    .sort((a, b) => a.index - b.index);
  const first = present.some((x) => x.index === 0) ? 0 : 1;
  const have = new Set(present.map((x) => x.index));
  const last = Math.max(expectedParts !== undefined ? first + expectedParts - 1 : 0, ...present.map((x) => x.index));
  const missing: number[] = [];
  for (let i = first; i <= last && missing.length < 1000; i++) if (!have.has(i)) missing.push(i);
  return { base: p.base, width: p.width, first, present: present.filter((x) => x.index >= first), missing };
}

export const JoinOptionsSchema = z.object({
  /** Keep the joined file even when its SHA-256 does not match the descriptor. */
  keepOnMismatch: z.boolean(),
});

export interface JoinPlan {
  folder: string;
  base: string;
  parts: Array<{ name: string; path: string; size: number; expectedSize?: number; expectedSha256?: string }>;
  missing: string[];
  totalBytes: number;
  /** The output name (made unique when taken). */
  output: string;
  outputTaken: boolean;
  descriptor?: { name: string; originalName: string; size: number; sha256: string; parts: number };
  /** The descriptor exists but could not be used (the join is then not verified). */
  descriptorProblem?: string;
  /** Sizes that disagree with the descriptor (found before joining). */
  sizeProblems: string[];
}

// ------------------------------------------------------------------ shred

export const ShredParamsSchema = z.object({
  passes: z.union([z.literal(1), z.literal(3)]),
  /** Set by the dialog only after the second confirmation. */
  confirmed: z.literal(true),
});

export interface ShredFsInfo {
  /** A folder on the drive (the parent of the first item on it). */
  where: string;
  /** File system type ("ext4", "btrfs", …) or "unknown". */
  type: string;
  copyOnWrite: boolean;
  /** true: SSD/flash (Linux /sys rotational = 0); false: spinning disk; undefined: not known. */
  solidState?: boolean;
  warnings: string[];
}

export interface ShredInfo {
  items: Array<{ path: string; kind: 'file' | 'directory' | 'symlink' | 'other'; size: number }>;
  files: number;
  folders: number;
  links: number;
  others: number;
  bytes: number;
  /** Files with other hard links (their contents are shared and are not overwritten). */
  hardLinked: number;
  filesystems: ShredFsInfo[];
  truncated: boolean;
}

/** Linux statfs f_type magic numbers → name and whether it is copy-on-write. */
export const LINUX_FS_TYPES: Record<number, { name: string; cow?: boolean; network?: boolean; note?: string }> = {
  0xef53: { name: 'ext2/3/4' },
  0x9123683e: { name: 'btrfs', cow: true },
  0x2fc12fc1: { name: 'ZFS', cow: true },
  0xca451a4e: { name: 'bcachefs', cow: true },
  0x58465342: { name: 'XFS', note: 'XFS can share blocks between files (reflinks).' },
  0xf2f52010: { name: 'F2FS', cow: true, note: 'F2FS writes new data to new places (log-structured).' },
  0x01021994: { name: 'tmpfs' },
  0x794c7630: { name: 'overlayfs', cow: true, note: 'Overlay file systems keep the lower layer unchanged.' },
  0x6969: { name: 'NFS', network: true },
  0xff534d42: { name: 'CIFS/SMB', network: true },
  0xfe534d42: { name: 'SMB2', network: true },
  0x65735546: { name: 'FUSE', note: 'A FUSE file system (for example a cloud drive or NTFS-3G) decides itself where data goes.' },
  0x4d44: { name: 'FAT' },
  0x2011bab0: { name: 'exFAT' },
  0x5346544e: { name: 'NTFS' },
  0x7366746e: { name: 'NTFS (ntfs3)' },
  0x3153464a: { name: 'JFS' },
  0x52654973: { name: 'ReiserFS' },
  0x73717368: { name: 'SquashFS' },
  0x9fa0: { name: 'proc' },
};

// ------------------------------------------------------------------ flatten

export const FlattenSpecSchema = z.object({
  removeEmpty: z.boolean(),
  includeHidden: z.boolean(),
});
export type FlattenSpec = z.infer<typeof FlattenSpecSchema>;
export const MAX_FLATTEN_FILES = 100_000;

export interface FlattenMove {
  source: string;
  /** Path below the folder, "/"-separated. */
  rel: string;
  name: string;
  target: string;
  conflict?: 'exists' | 'twice';
}

export interface FlattenPlan {
  root: string;
  moves: FlattenMove[];
  /** Subfolders found. */
  folders: number;
  /** Folders that will be empty afterwards (removed when chosen; deepest first). */
  emptyAfter: string[];
  links: number;
  hidden: number;
  others: number;
  truncated: boolean;
  /** Preview only: all moves (the list itself is limited to the first 2,000) and how many have a name conflict. */
  movesTotal?: number;
  conflicts?: number;
}

// ------------------------------------------------------------------ set dates

export const DatesSpecSchema = z.object({
  mode: z.enum(['datetime', 'now', 'exif', 'filename']),
  /** For "datetime": local date and time chosen in the dialog, as milliseconds. */
  datetimeMs: z.number().finite().optional(),
  modified: z.boolean(),
  accessed: z.boolean(),
  recursive: z.boolean(),
}).refine((s) => s.modified || s.accessed, 'Choose the modification time, the access time or both.')
  .refine((s) => s.mode !== 'datetime' || s.datetimeMs !== undefined, 'Choose a date and time.');
export type DatesSpec = z.infer<typeof DatesSpecSchema>;
export const MAX_DATES_ITEMS = 200_000;

export interface DatesPlanItem {
  path: string;
  name: string;
  kind: 'file' | 'directory' | 'symlink' | 'other';
  mtimeMs: number;
  atimeMs: number;
  /** New times (absent when the item is left alone). */
  next?: { mtimeMs: number; atimeMs: number };
  /** Where the new date came from ("EXIF date taken", "name: IMG_20240131_101500"…). */
  source?: string;
  reason?: string;
}

export interface DatesPlan {
  items: DatesPlanItem[];
  truncated: boolean;
  /** Preview only: all items (the list itself is limited to the first 5,000) and how many change. */
  total?: number;
  changing?: number;
}

/** One item to change: its new times (the runner records the previous ones for Undo). */
export const DatesApplyItemSchema = z.object({
  path: pathStr,
  mtimeMs: z.number().finite().min(0).max(32503680000000),
  atimeMs: z.number().finite().min(0).max(32503680000000),
  /** Undo only: the item is changed back only while its modification time is still this one. */
  expectMtimeMs: z.number().finite().optional(),
});
export type DatesApplyItem = z.infer<typeof DatesApplyItemSchema>;

const validDate = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): boolean => {
  if (y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
};

/**
 * A date written in a file name, read as local time: IMG_20240131_101500, PXL_20240131_101500123,
 * VID-20240131-WA0001, Screenshot 2024-01-31 at 10.15.00, 2024-01-31_10-15-00, 2024-01-31, 2024_01_31, 20240131.
 * Dates before 1970 or after 2099 and impossible dates (2024-02-30) are not dates.
 */
export function dateFromFileName(name: string): { ms: number; text: string; match: string } | undefined {
  const stem = name.replace(/\.[^.]*$/, '') || name;
  const pats: Array<{ re: RegExp; time: boolean }> = [
    { re: /(?<!\d)(\d{4})(\d{2})(\d{2})[_\-T ]?(\d{2})(\d{2})(\d{2})(?:\d{3})?(?!\d)/, time: true },
    { re: /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?:[ _T.-]+(?:at )?)(\d{2})[.:h-](\d{2})[.:m-](\d{2})(?!\d)/i, time: true },
    { re: /(?<!\d)(\d{4})[-_.](\d{2})[-_.](\d{2})(?!\d)/, time: false },
    { re: /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/, time: false },
  ];
  for (const { re, time } of pats) {
    const m = re.exec(stem);
    if (!m) continue;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const [h, mi, s] = time ? [Number(m[4]), Number(m[5]), Number(m[6])] : [0, 0, 0];
    if (!validDate(y, mo, d, h, mi, s)) continue;
    const ms = new Date(y, mo - 1, d, h, mi, s).getTime();
    const p2 = (n: number) => String(n).padStart(2, '0');
    return { ms, text: `${y}-${p2(mo)}-${p2(d)}${time ? ` ${p2(h)}:${p2(mi)}:${p2(s)}` : ''}`, match: m[0] };
  }
  return undefined;
}

/** EXIF "YYYY-MM-DD HH:MM:SS" (or with colons in the date) as local time, the way cameras record it. */
export function exifDateMs(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = /^(\d{4})[-:](\d{2})[-:](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return undefined;
  const v = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (!validDate(...v)) return undefined;
  return new Date(v[0], v[1] - 1, v[2], v[3], v[4], v[5]).getTime();
}

// ------------------------------------------------------------------ links

export const LinkItemSchema = z.object({ target: pathStr, name: nameStr });
export const LinkParamsSchema = z.object({
  kind: z.enum(['hard', 'junction']),
  items: z.array(LinkItemSchema).min(1).max(10_000),
});

// ------------------------------------------------------------------ clipboard

export const CLIP_HISTORY_MAX = 10;
export const CLIP_TEXT_PREVIEW = 600;
/** Largest text pasted as a file. */
export const CLIP_TEXT_MAX = 64 * MiB;
export const PASTE_TEXT_FORMATS = ['txt', 'md', 'json', 'csv'] as const;
export type PasteTextFormat = (typeof PASTE_TEXT_FORMATS)[number];

export interface ClipPeek {
  /** File items on the clipboard (from Orbis Files, another file manager or a list of paths). */
  files: { count: number; mode: 'copy' | 'cut'; names: string[]; source: 'orbis' | 'uri-list' | 'gnome' | 'paths' | 'platform' } | null;
  image: boolean;
  text: { length: number; lines: number; preview: string; json: boolean } | null;
  /** The clipboard still holds the file list Orbis Files put there. */
  ours: boolean;
  /** Orbis Files put a file list there, but none of the items exists any more (e.g. after a cut and paste). */
  staleOurs: boolean;
  formats: string[];
}

export interface ClipHistoryEntry {
  id: string;
  mode: 'copy' | 'cut';
  timeMs: number;
  count: number;
  firstNames: string[];
  /** How many of the items no longer exist (filled in when the history is listed). */
  missing: number;
  /** Items on a server (not checked). */
  remote: number;
}

/** "Pasted image 2026-10-12 05-30.png" (local time). */
export function defaultPasteName(kind: 'image' | 'text', ext: string, now = new Date()): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `Pasted ${kind} ${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}-${p2(now.getMinutes())}.${ext}`;
}

/** Local paths from a text/uri-list (comments and other schemes are left out; file://host/… only for localhost). */
export function parseUriList(text: string, platform: string = typeof process !== 'undefined' ? process.platform : 'linux'): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const p = fileUriToPath(line, platform);
    if (p) out.push(p);
  }
  return out;
}

export function fileUriToPath(uri: string, platform: string): string | undefined {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'file:') return undefined;
  if (u.host && u.host !== 'localhost') {
    if (platform !== 'win32') return undefined;
    return `\\\\${u.host}${decodeURIComponent(u.pathname).replace(/\//g, '\\')}`;
  }
  let p: string;
  try {
    p = decodeURIComponent(u.pathname);
  } catch {
    return undefined;
  }
  if (p.includes('\0')) return undefined;
  if (platform === 'win32') {
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
    return p.replace(/\//g, '\\');
  }
  return p;
}

/** GNOME/Nautilus/Caja/Nemo "x-special/gnome-copied-files": "copy" or "cut", then file URIs. */
export function parseGnomeCopiedFiles(text: string, platform = 'linux'): { mode: 'copy' | 'cut'; paths: string[] } | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const mode = lines[0];
  if (mode !== 'copy' && mode !== 'cut') return undefined;
  return { mode, paths: parseUriList(lines.slice(1).join('\n'), platform) };
}

/** Text that is nothing but absolute paths, one per line (at most 10,000), as other apps and Orbis Files write them. */
export function pathsFromText(text: string, platform: string): string[] | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length || lines.length > 10_000) return undefined;
  const abs = platform === 'win32' ? /^(?:[A-Za-z]:\\|\\\\[^\\]+\\)/ : /^\//;
  if (!lines.every((l) => abs.test(l) && !l.includes('\0'))) return undefined;
  return lines;
}

// ------------------------------------------------------------------ IPC schemas (spread into shared/ipc.ts)

const splitDest = pathStr.optional();
export const PowerToolsSchemas = {
  /** Split one file into numbered parts (starts a 'split-file' operation). */
  'pt:splitStart': z.object({ path: pathStr, destination: splitDest, params: SplitParamsSchema }),
  /** The parts of the sequence a part belongs to, missing parts and the descriptor (nothing is read but names, sizes and the descriptor). */
  'pt:joinPlan': z.object({ path: pathStr }),
  'pt:joinStart': z.object({ path: pathStr, destination: splitDest, options: JoinOptionsSchema }),
  /** Counts and file-system warnings for a secure delete (a background job). */
  'pt:shredInfo': z.object({ paths: z.array(pathStr).min(1).max(10_000), jobId: idStr }),
  'pt:shredStart': z.object({ paths: z.array(pathStr).min(1).max(10_000), params: ShredParamsSchema }),
  'pt:flattenPlan': z.object({ path: pathStr, spec: FlattenSpecSchema, jobId: idStr }),
  'pt:flattenStart': z.object({ path: pathStr, spec: FlattenSpecSchema }),
  'pt:datesPlan': z.object({ paths: z.array(pathStr).min(1).max(10_000), spec: DatesSpecSchema, jobId: idStr }),
  /** Planned again in the operation (with "now" taken when it runs); the preview showed the same plan. */
  'pt:datesStart': z.object({ paths: z.array(pathStr).min(1).max(10_000), spec: DatesSpecSchema }),
  /** What the platform can do (birth time, junctions, hard links). */
  'pt:capabilities': z.object({}),
  'pt:linkStart': z.object({ destination: pathStr, params: LinkParamsSchema }),
  // Clipboard
  'clip:peek': z.object({}),
  /** The full list of files on the clipboard (for pasting). */
  'clip:readFiles': z.object({}),
  /** Copy or cut file items: their paths go to the system clipboard as text and into the history. */
  'clip:setFiles': z.object({ mode: z.enum(['copy', 'cut']), paths: z.array(pathStr).min(1).max(100_000), text: z.string().max(10_000_000) }),
  'clip:history': z.object({}),
  'clip:historyItems': z.object({ id: idStr }),
  'clip:clearHistory': z.object({}),
  'clip:imageInfo': z.object({}),
  'clip:pasteImage': z.object({ dir: pathStr, name: nameStr }),
  'clip:pasteText': z.object({ dir: pathStr, name: nameStr }),
  'clip:copyImage': z.object({ path: pathStr }),
  /** A PNG the window decoded (formats the main process cannot read: WebP, GIF, BMP, AVIF). */
  'clip:writeImagePng': z.object({ path: pathStr, pngBase64: z.string().min(8).max(96 * MiB) }),
  // Clipboard pins (persisted in DB)
  'clip:pins': z.object({}),
  'clip:pin': z.object({ id: idStr, mode: z.enum(['copy', 'cut']), paths: z.array(pathStr).min(1).max(100_000), label: z.string().max(256).optional() }),
  'clip:unpin': z.object({ id: idStr }),
} as const;
