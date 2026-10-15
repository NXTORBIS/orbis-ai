import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { splitExt, validateName } from '../fs/paths';
import { safeRegex } from '../search/query';
import { mapLimit } from '../fs/FileSystemService';
import { RenameSpecSchema, type RenamePreview, type RenamePreviewItem, type RenameRule, type RenameSpec, type RenameSpecInput, type RenameStatus } from '../../shared/rename';
import type { MediaMeta } from '../../shared/media';

/**
 * Bulk rename preview: runs the rule pipeline on every item and classifies the
 * result. Nothing is renamed here; only `renamed` rows are submitted to the
 * operation engine as one rename-batch operation (two-phase, undoable).
 */

export type MetaReader = (p: string) => Promise<MediaMeta>;

// ---------------------------------------------------------------- text helpers (exported for tests)

export function words(s: string): string[] {
  return s
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function changeCase(s: string, mode: Extract<RenameRule, { type: 'case' }>['mode']): string {
  switch (mode) {
    case 'lower': return s.toLowerCase();
    case 'upper': return s.toUpperCase();
    case 'title': return s.toLowerCase().replace(/(^|[\s_\-.([])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
    case 'sentence': {
      const low = s.toLowerCase();
      return low.replace(/\p{L}/u, (ch) => ch.toUpperCase());
    }
    case 'camel': return words(s).map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase())).join('');
    case 'kebab': return words(s).map((w) => w.toLowerCase()).join('-');
    case 'snake': return words(s).map((w) => w.toLowerCase()).join('_');
  }
}

const EXTRA_FOLD: Record<string, string> = { ß: 'ss', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ø: 'o', Ø: 'O', đ: 'd', Đ: 'D', ł: 'l', Ł: 'L', þ: 'th', Þ: 'Th', ı: 'i' };

/** Remove accents (é → e) and fold a few letters that do not decompose (ß → ss, ø → o). */
export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC').replace(/[ßæÆœŒøØđĐłŁþÞı]/g, (c) => EXTRA_FOLD[c] ?? c);
}

export interface DateParts { Y: number; M: number; D: number; h: number; m: number; s: number }

export function partsFromMs(ms: number): DateParts {
  const d = new Date(ms);
  return { Y: d.getFullYear(), M: d.getMonth() + 1, D: d.getDate(), h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() };
}

/** EXIF dates are camera-local wall-clock time ("2024-07-14 18:22:05"); they are used as written, without time-zone conversion. */
export function partsFromExif(taken: string | undefined): DateParts | undefined {
  const m = taken?.match(/^(\d{4})[-:](\d{2})[-:](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return undefined;
  const p = { Y: +m[1]!, M: +m[2]!, D: +m[3]!, h: +(m[4] ?? 0), m: +(m[5] ?? 0), s: +(m[6] ?? 0) };
  if (p.Y < 1800 || p.M < 1 || p.M > 12 || p.D < 1 || p.D > 31) return undefined; // "0000:00:00 00:00:00" means unset
  return p;
}

/** Format tokens: YYYY, YY, MM (month), DD, hh, mm (minute), ss. Everything else is copied as is. */
export function formatDate(p: DateParts, format: string): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return format.replace(/YYYY|YY|MM|DD|hh|mm|ss/g, (t) => {
    switch (t) {
      case 'YYYY': return String(p.Y).padStart(4, '0');
      case 'YY': return two(p.Y % 100);
      case 'MM': return two(p.M);
      case 'DD': return two(p.D);
      case 'hh': return two(p.h);
      case 'mm': return two(p.m);
      default: return two(p.s);
    }
  });
}

function insertAt(s: string, text: string, at: 'start' | 'end' | 'index', index: number): string {
  if (at === 'start') return text + s;
  if (at === 'end') return s + text;
  const chars = [...s];
  const i = Math.min(index, chars.length);
  return chars.slice(0, i).join('') + text + chars.slice(i).join('');
}

function removeChars(s: string, r: Extract<RenameRule, { type: 'remove' }>): string {
  const chars = [...s]; // by characters, not UTF-16 units
  if (r.mode === 'start') return chars.slice(r.count).join('');
  if (r.mode === 'end') return chars.slice(0, Math.max(0, chars.length - r.count)).join('');
  return [...chars.slice(0, r.from), ...chars.slice(r.from + r.count)].join('');
}

class RuleError extends Error {}

const TOKEN = /\{([a-z]+)(?::([^{}]{1,32}))?\}/g;
const KNOWN_TOKENS = new Set(['name', 'ext', 'n', 'parent', 'date', 'created', 'taken', 'width', 'height']);

/** Rules whose output depends on embedded metadata (read only when needed). */
function needsMeta(rules: RenameRule[]): boolean {
  return rules.some((r) => r.enabled && ((r.type === 'date' && r.source === 'exif') || ((r.type === 'insert' || r.type === 'template') && /\{(taken|width|height)\b/.test(r.type === 'insert' ? r.text : r.pattern))));
}

function checkTokens(text: string): void {
  for (const m of text.matchAll(TOKEN)) {
    if (!KNOWN_TOKENS.has(m[1]!)) throw new RuleError(`Unknown token {${m[1]}}.`);
    if (m[1] === 'n' && m[2] !== undefined && !/^\d$|^10$/.test(m[2])) throw new RuleError('Use {n} or {n:3} (up to 10 digits).');
  }
}

interface ItemContext {
  from: string;
  oldName: string;
  st: fs.Stats;
  isDir: boolean;
  /** 1-based position in the processing order. */
  position: number;
  meta?: MediaMeta;
}

class SkipItem extends Error {}

function expandTokens(text: string, c: ItemContext): string {
  const { stem, ext } = c.isDir ? { stem: c.oldName, ext: '' } : splitExt(c.oldName);
  return text.replace(TOKEN, (_all, tok: string, arg: string | undefined) => {
    switch (tok) {
      case 'name': return stem;
      case 'ext': return ext.replace(/^\./, '');
      case 'n': return String(c.position).padStart(arg ? Number(arg) : 0, '0');
      case 'parent': return path.basename(path.dirname(c.from));
      case 'date': return formatDate(partsFromMs(c.st.mtimeMs), arg ?? 'YYYY-MM-DD');
      case 'created': return formatDate(partsFromMs(c.st.birthtimeMs || c.st.mtimeMs), arg ?? 'YYYY-MM-DD');
      case 'taken': {
        const p = partsFromExif(c.meta?.exif?.takenAt);
        if (!p) throw new SkipItem('No camera date (EXIF DateTimeOriginal) in this file.');
        return formatDate(p, arg ?? 'YYYY-MM-DD');
      }
      case 'width':
      case 'height': {
        const v = tok === 'width' ? c.meta?.width : c.meta?.height;
        if (!v) throw new SkipItem('The image size is not known for this file.');
        return String(v);
      }
      default: return _all;
    }
  });
}

/** Run the pipeline on one name. `counter` is the numbering value for this item. */
function applyRules(spec: RenameSpec, compiled: Map<RenameRule, RegExp>, c: ItemContext, counter: (r: Extract<RenameRule, { type: 'number' }>) => number): string {
  const whole = c.isDir || spec.includeExtension;
  let { stem: s, ext } = whole ? { stem: c.oldName, ext: '' } : splitExt(c.oldName);
  for (const r of spec.rules) {
    if (!r.enabled) continue;
    switch (r.type) {
      case 'replace': {
        const re = compiled.get(r);
        if (re) s = s.replace(re, r.replace);
        break;
      }
      case 'insert':
        s = insertAt(s, expandTokens(r.text, c), r.at, r.index);
        break;
      case 'remove':
        s = removeChars(s, r);
        break;
      case 'case':
        s = changeCase(s, r.mode);
        break;
      case 'number': {
        const v = counter(r);
        const num = (v < 0 ? '-' : '') + String(Math.abs(v)).padStart(r.pad, '0');
        s = r.at === 'start' ? `${num}${r.separator}${s}` : r.at === 'end' ? `${s}${r.separator}${num}` : insertAt(s, num, 'index', r.index);
        break;
      }
      case 'date': {
        let p: DateParts | undefined;
        if (r.source === 'exif') {
          p = partsFromExif(c.meta?.exif?.takenAt);
          if (!p) {
            if (r.fallback === 'skip') throw new SkipItem('No camera date (EXIF DateTimeOriginal) in this file.');
            p = partsFromMs(c.st.mtimeMs);
          }
        } else p = partsFromMs(r.source === 'created' ? c.st.birthtimeMs || c.st.mtimeMs : c.st.mtimeMs);
        const d = formatDate(p, r.format);
        s = r.at === 'start' ? `${d}${r.separator}${s}` : `${s}${r.separator}${d}`;
        break;
      }
      case 'extension': {
        if (c.isDir) break;
        // With "include extension" the extension is part of `s`; split it off for this rule.
        if (whole) {
          const sp = splitExt(s);
          s = sp.stem;
          ext = sp.ext;
        }
        if (r.mode === 'lower') ext = ext.toLowerCase();
        else if (r.mode === 'upper') ext = ext.toUpperCase();
        else if (r.mode === 'remove') ext = '';
        else {
          const v = r.value.trim().replace(/^\.+/, '');
          ext = v ? `.${v}` : '';
        }
        if (whole) {
          s += ext;
          ext = '';
        }
        break;
      }
      case 'spaces':
        if (r.underscores === 'to-spaces') s = s.replace(/_/g, ' ');
        else if (r.underscores === 'from-spaces') s = s.replace(/ /g, '_');
        if (r.collapse) s = s.replace(/[ \t\u00a0]{2,}/g, ' ');
        if (r.trim) s = s.trim();
        break;
      case 'diacritics':
        s = stripDiacritics(s);
        break;
      case 'template':
        s = expandTokens(r.pattern, c);
        break;
    }
  }
  return s + ext;
}

function compileRules(spec: RenameSpec): Map<RenameRule, RegExp> {
  const out = new Map<RenameRule, RegExp>();
  spec.rules.forEach((r, i) => {
    if (!r.enabled) return;
    try {
      if (r.type === 'replace' && r.find) {
        const flags = r.caseSensitive ? 'gu' : 'giu';
        out.set(r, r.regex ? new RegExp(safeRegex(r.find, 0).source, flags) : new RegExp(r.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags));
      }
      if (r.type === 'insert') checkTokens(r.text);
      if (r.type === 'template') checkTokens(r.pattern);
      if (r.type === 'extension' && r.mode === 'set' && /[\\/]/.test(r.value)) throw new RuleError('An extension cannot contain "/" or "\\".');
    } catch (err) {
      throw new RuleError(`Rule ${i + 1}: ${(err as Error).message}`);
    }
  });
  return out;
}

/** Longest path the platform accepts (Windows without long-path support: 259 characters). */
function maxPath(platform: NodeJS.Platform): number {
  return platform === 'win32' ? 259 : 4095;
}

/** Whether names in `dir` are compared case-insensitively, probed with an existing item in it. */
async function caseInsensitiveDir(sample: string, st: fs.Stats): Promise<boolean> {
  const name = path.basename(sample);
  const flipped = name.replace(/\p{L}/gu, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
  if (flipped === name) return process.platform === 'win32' || process.platform === 'darwin';
  const other = await fsp.lstat(path.join(path.dirname(sample), flipped)).catch(() => undefined);
  return !!other && other.ino === st.ino && other.dev === st.dev;
}

const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

export async function previewBulkRename(paths: string[], specInput: RenameSpecInput, opts: { readMeta?: MetaReader; platform?: NodeJS.Platform } = {}): Promise<RenamePreview> {
  const counts: Record<RenameStatus, number> = { renamed: 0, unchanged: 0, conflict: 0, duplicate: 0, invalid: 0 };
  const parsed = RenameSpecSchema.safeParse(specInput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const [where, i, field] = issue?.path ?? [];
    if (where === 'rules' && typeof i === 'number') {
      const what = issue?.code === 'too_small' && typeof field === 'string' ? `${field === 'pattern' ? 'the pattern' : field === 'format' ? 'the date format' : field} cannot be empty.` : issue?.message ?? 'not valid.';
      return { items: [], counts, error: `Rule ${i + 1}: ${what}` };
    }
    return { items: [], counts, error: `The rename rules are not valid: ${issue?.message ?? ''}` };
  }
  const spec = parsed.data;
  const platform = opts.platform ?? process.platform;
  let compiled: Map<RenameRule, RegExp>;
  try {
    compiled = compileRules(spec);
  } catch (err) {
    return { items: [], counts, error: (err as Error).message };
  }

  // Stat every item once (a missing item is shown, never renamed).
  const unique = [...new Set(paths.map((p) => path.resolve(p)))];
  const stats = await mapLimit(unique, 16, (p) => fsp.lstat(p).catch(() => undefined));
  let entries = unique.map((p, i) => ({ from: p, st: stats[i] }));
  if (spec.order === 'name') entries = entries.slice().sort((a, b) => naturalCompare(path.basename(a.from), path.basename(b.from)));
  else if (spec.order === 'modified') entries = entries.slice().sort((a, b) => (a.st?.mtimeMs ?? 0) - (b.st?.mtimeMs ?? 0));

  const metas = new Map<string, MediaMeta>();
  if (opts.readMeta && needsMeta(spec.rules)) {
    const reader = opts.readMeta;
    await mapLimit(entries.filter((e) => e.st?.isFile()), 8, async (e) => {
      const m = await reader(e.from).catch(() => undefined);
      if (m) metas.set(e.from, m);
    });
  }

  type Row = RenamePreviewItem & { dir: string; st?: fs.Stats };
  const rows: Row[] = [];
  const numberCounters = new Map<string, number>();
  for (const [i, e] of entries.entries()) {
    const oldName = path.basename(e.from);
    const dir = path.dirname(e.from);
    if (!e.st) {
      rows.push({ from: e.from, to: e.from, oldName, newName: oldName, status: 'invalid', reason: 'The item no longer exists.', dir });
      continue;
    }
    const st = e.st;
    const ctx: ItemContext = { from: e.from, oldName, st, isDir: st.isDirectory(), position: i + 1, meta: metas.get(e.from) };
    const counter = (r: Extract<RenameRule, { type: 'number' }>) => {
      const key = `${spec.rules.indexOf(r)}\0${r.perFolder ? dir : ''}`;
      const k = numberCounters.get(key) ?? 0;
      numberCounters.set(key, k + 1);
      return r.start + k * r.step;
    };
    let newName: string;
    try {
      newName = applyRules(spec, compiled, ctx, counter);
    } catch (err) {
      if (err instanceof SkipItem) {
        rows.push({ from: e.from, to: e.from, oldName, newName: oldName, status: 'invalid', reason: err.message, dir, st });
        continue;
      }
      throw err;
    }
    const to = path.join(dir, newName);
    const v = validateName(newName, platform);
    if (newName === oldName) rows.push({ from: e.from, to, oldName, newName, status: 'unchanged', dir, st });
    else if (!v.valid) rows.push({ from: e.from, to, oldName, newName, status: 'invalid', reason: v.reason, dir, st });
    else if (to.length > maxPath(platform)) rows.push({ from: e.from, to, oldName, newName, status: 'invalid', reason: `The full path would be longer than ${maxPath(platform)} characters.`, dir, st });
    else rows.push({ from: e.from, to, oldName, newName, status: 'renamed', dir, st });
  }

  // Folders that compare names case-insensitively (probed on disk), so clashes are judged like the file system does.
  const ciDirs = new Map<string, boolean>();
  for (const r of rows) if (r.st && !ciDirs.has(r.dir)) ciDirs.set(r.dir, await caseInsensitiveDir(r.from, r.st));
  const key = (dir: string, name: string) => `${dir}\0${ciDirs.get(dir) ? name.toLowerCase() : name}`;
  const bySourceKey = new Map(rows.map((r) => [key(r.dir, r.oldName), r]));
  /** What is at a row's target on disk right now. */
  const disk = new Map<Row, 'free' | 'self' | 'other' | Row>();
  const probe = async (r: Row, name: string): Promise<'free' | 'self' | 'other' | Row> => {
    const other = bySourceKey.get(key(r.dir, name));
    if (other === r) return 'self';
    const st = await fsp.lstat(path.join(r.dir, name)).catch(() => undefined);
    if (!st) return 'free';
    if (r.st && st.ino === r.st.ino && st.dev === r.st.dev) return 'self'; // case-only rename on a case-insensitive drive
    return other ?? 'other';
  };
  for (const r of rows) if (r.status === 'renamed') disk.set(r, await probe(r, r.newName));

  if (spec.onConflict === 'suffix') {
    // Names that stay where they are, then each renamed item in order claims a free name.
    const claimed = new Set(rows.filter((r) => r.status !== 'renamed').map((r) => key(r.dir, r.oldName)));
    for (const r of rows) {
      if (r.status !== 'renamed') continue;
      const { stem, ext } = r.st?.isDirectory() ? { stem: r.newName, ext: '' } : splitExt(r.newName);
      let candidate = r.newName;
      let state = disk.get(r)!;
      for (let n = 2; ; n++) {
        const free = !claimed.has(key(r.dir, candidate)) && (state === 'free' || state === 'self' || (typeof state === 'object' && state.status === 'renamed'));
        if (free) break;
        if (n > 9999) {
          r.status = 'conflict';
          r.reason = 'No free name was found.';
          break;
        }
        candidate = `${stem} (${n})${ext}`;
        state = await probe(r, candidate);
      }
      if (r.status !== 'renamed') continue;
      if (candidate !== r.newName) {
        r.newName = candidate;
        r.to = path.join(r.dir, candidate);
        r.suffixed = true;
        r.reason = 'A number was added to avoid a clash.';
        const v = validateName(candidate, platform);
        if (!v.valid) {
          r.status = 'invalid';
          r.reason = v.reason;
          continue;
        }
      }
      claimed.add(key(r.dir, candidate));
    }
  } else {
    // Block: repeat until stable, because an item that cannot be renamed keeps its name occupied.
    for (let pass = 0; pass < 100; pass++) {
      let changed = false;
      const byTarget = new Map<string, Row[]>();
      for (const r of rows) if (r.status === 'renamed') byTarget.set(key(r.dir, r.newName), [...(byTarget.get(key(r.dir, r.newName)) ?? []), r]);
      for (const list of byTarget.values()) {
        if (list.length < 2) continue;
        for (const r of list) {
          r.status = 'duplicate';
          r.reason = `${list.length} items in this batch would get this name.`;
          changed = true;
        }
      }
      for (const r of rows) {
        if (r.status !== 'renamed') continue;
        const state = disk.get(r)!;
        if (state === 'other' || (typeof state === 'object' && state.status !== 'renamed')) {
          r.status = 'conflict';
          r.reason = typeof state === 'object' ? `"${state.oldName}" keeps this name (it is not being renamed).` : 'An item with this name already exists.';
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  const items: RenamePreviewItem[] = rows.map(({ dir: _d, st: _s, ...r }) => r);
  for (const i of items) counts[i.status]++;
  return { items, counts };
}
