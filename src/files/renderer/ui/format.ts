import type { FileEntry } from '../../shared/model';
import { TYPE_GROUPS } from '../../shared/fileTypes';

/** Consistent formatting for sizes, dates, counts and kinds. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function formatBytes(n: number | undefined, unavailable = '—'): string {
  if (n === undefined || n === null || Number.isNaN(n)) return unavailable;
  if (n < 1024) return `${n} B`;
  let i = 0;
  let v = n;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${UNITS[i]}`;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const dateOnly = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export function formatDate(ms: number | undefined, unavailable = '—'): string {
  if (!ms) return unavailable;
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `Today, ${timeOnly.format(d)}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${timeOnly.format(d)}`;
  return dateFmt.format(d);
}

/** A schedule's "HH:MM" in the user's time format (e.g. 6:00 PM or 18:00). */
export function formatTimeOfDay(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return timeOnly.format(new Date(2000, 0, 1, h ?? 0, m ?? 0));
}

export function formatDay(ms: number): string {
  return dateOnly.format(new Date(ms));
}

export function formatFullDate(ms: number | undefined): string {
  if (!ms) return 'Not available';
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'medium' });
}

export function formatCount(n: number, noun: string, plural = `${noun}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? noun : plural}`;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export type Category = 'folder' | 'image' | 'video' | 'audio' | 'document' | 'spreadsheet' | 'presentation' | 'archive' | 'code' | 'text' | 'pdf' | 'executable' | 'link' | 'other';

const EXEC = new Set(['exe', 'msi', 'app', 'apk', 'dmg', 'deb', 'rpm', 'appimage', 'bat', 'cmd', 'sh', 'command', 'run', 'bin']);

export function categoryOfEntry(e: Pick<FileEntry, 'kind' | 'ext' | 'linkTargetKind'>): Category {
  if (e.kind === 'directory' || (e.kind === 'symlink' && e.linkTargetKind === 'directory')) return 'folder';
  if (e.ext === 'pdf') return 'pdf';
  if (EXEC.has(e.ext)) return 'executable';
  for (const cat of ['image', 'video', 'audio', 'spreadsheet', 'presentation', 'archive', 'code', 'document', 'text'] as const) {
    if (TYPE_GROUPS[cat]!.includes(e.ext)) return cat;
  }
  return 'other';
}

const KIND_LABEL: Record<Category, string> = {
  folder: 'Folder', image: 'Image', video: 'Video', audio: 'Audio', document: 'Document', spreadsheet: 'Spreadsheet', presentation: 'Presentation',
  archive: 'Archive', code: 'Source code', text: 'Text', pdf: 'PDF document', executable: 'Program', link: 'Link', other: 'File',
};

export function kindLabel(e: FileEntry): string {
  if (e.kind === 'symlink') return e.linkTargetKind === 'broken' ? 'Broken link' : `Link to ${e.linkTargetKind === 'directory' ? 'folder' : 'file'}`;
  if (e.kind === 'other') return e.statError ? 'Unreadable item' : 'Special file';
  const cat = categoryOfEntry(e);
  if (cat === 'folder') return 'Folder';
  if (cat === 'other' && e.ext) return `${e.ext.toUpperCase()} file`;
  if (e.ext && cat !== 'other') return `${KIND_LABEL[cat]} (${e.ext.toUpperCase()})`;
  return KIND_LABEL[cat];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const naturalCompare = (a: string, b: string): number => collator.compare(a, b);

export function middleTruncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const keep = Math.floor((max - 1) / 2);
  return `${s.slice(0, keep)}…${s.slice(s.length - keep)}`;
}

/** Media running time as m:ss or h:mm:ss. */
export function formatMediaDuration(sec: number | undefined, estimated = false): string {
  if (sec === undefined || !Number.isFinite(sec)) return '—';
  const t = Math.round(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const core = h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return estimated ? `≈${core}` : core;
}

/** The host of a web address, or the address itself when it cannot be parsed (addresses registered by other apps may be anything). */
export function urlHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
