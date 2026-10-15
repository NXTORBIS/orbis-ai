/**
 * Orbis Files query language (documented in docs/SEARCH.md).
 *
 *   report                 name contains "report" (case-insensitive)
 *   "annual report"        name contains the exact phrase
 *   *.pdf  rep?rt          wildcards (* any run, ? one char) — whole-name match
 *   ~reprot                fuzzy name match (typo tolerant)
 *   name:report path:projects ext:pdf
 *   type:pdf | type:image|video|audio|document|archive|code|text|spreadsheet|presentation
 *   is:file is:folder is:link is:hidden
 *   size:>100MB size:<1KB size:10MB..1GB
 *   modified:today|yesterday|last7days|last30days|thisyear|>2024-01-01|2024-01..2024-03
 *   created:… accessed:… (same forms)   tag:school   content:"needle"
 *   note:budget rating:>=4 source:download|generated|import collection:"Trip" project:orbis
 *   width:>1920 height:<1080 pages:>10 duration:>5m taken:2024 camera:fuji artist:"…"
 *   regex:"^IMG_\d+"       validated regular expression on the name
 *   -term / -type:pdf      negation;  a OR b  alternation (AND binds tighter)
 *
 * Invalid syntax returns an error with its position; it is never silently
 * reinterpreted as a different query.
 */

export type Field = 'name' | 'path' | 'ext' | 'type' | 'is' | 'size' | 'modified' | 'created' | 'accessed' | 'tag' | 'content' | 'regex' | 'fuzzy' | 'wildcard'
  | 'note' | 'rating' | 'source' | 'collection' | 'project' | 'width' | 'height' | 'pages' | 'duration' | 'taken' | 'camera' | 'artist';

export interface Clause {
  field: Field;
  negate: boolean;
  /** Normalised value for the field (see evaluator). */
  value: string;
  num?: { op: '>' | '<' | '>=' | '<=' | '=' | 'range'; a: number; b?: number };
  regex?: RegExp;
}

export interface ParsedQuery {
  /** Disjunction of conjunctions. */
  groups: Clause[][];
  usesContent: boolean;
  usesTags: boolean;
  /** Needs metadata read from inside files (dimensions, duration, EXIF…). */
  usesMeta: boolean;
  /** Needs catalogue data (notes, ratings, sources, collections, projects). */
  usesCatalog: boolean;
  text: string;
}

export class QueryError extends Error {
  constructor(message: string, readonly position: number) {
    super(message);
  }
}

const SIZE_UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };

import { TYPE_GROUPS } from '../../shared/fileTypes';
export { TYPE_GROUPS };

const KEYS = new Set(['name', 'path', 'ext', 'type', 'is', 'size', 'modified', 'created', 'accessed', 'tag', 'content', 'regex', 'note', 'rating', 'source', 'collection', 'project', 'width', 'height', 'pages', 'duration', 'taken', 'camera', 'artist']);
const META_FIELDS = new Set(['width', 'height', 'pages', 'duration', 'taken', 'camera', 'artist']);
const CATALOG_FIELDS = new Set(['note', 'rating', 'source', 'collection', 'project']);
const SOURCES = new Set(['download', 'generated', 'import', 'filesystem']);

/** "90", "90s", "5m", "1h30m", "1:30", "1:02:03" → seconds. */
export function parseDurationSec(s: string, pos: number): number {
  const t = s.trim().toLowerCase();
  const colon = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(t);
  if (colon) return colon[3] !== undefined ? Number(colon[1]) * 3600 + Number(colon[2]) * 60 + Number(colon[3]) : Number(colon[1]) * 60 + Number(colon[2]);
  const m = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?:in)?)?(?:(\d+(?:\.\d+)?)s?)?$/.exec(t);
  if (!m || (!m[1] && !m[2] && !m[3])) throw new QueryError(`"${s}" is not a duration. Use forms like 90s, 5m, 1h30m or 1:30.`, pos);
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function parseIntValue(s: string, pos: number, what: string): number {
  if (!/^\d+$/.test(s.trim())) throw new QueryError(`"${s}" is not a ${what}.`, pos);
  return Number(s);
}
const IS_VALUES = new Set(['file', 'folder', 'dir', 'directory', 'link', 'symlink', 'hidden']);

interface Token { text: string; pos: number; quoted: boolean }

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    if (/\s/.test(input[i]!)) {
      i++;
      continue;
    }
    const start = i;
    let text = '';
    // A token is a literal phrase only when it starts with a quote; key:"value" keeps its key.
    const quoted = input[i] === '"';
    while (i < input.length && !/\s/.test(input[i]!)) {
      if (input[i] === '"') {
        const close = input.indexOf('"', i + 1);
        if (close < 0) throw new QueryError('Unclosed quotation mark.', i);
        text += input.slice(i + 1, close);
        i = close + 1;
      } else {
        text += input[i];
        i++;
      }
    }
    tokens.push({ text, pos: start, quoted });
  }
  return tokens;
}

export function parseSize(s: string, pos: number): number {
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/i.exec(s.trim());
  if (!m) throw new QueryError(`"${s}" is not a size. Use forms like 500KB, 10MB or 2GB.`, pos);
  const unit = (m[2] || 'b').toLowerCase();
  const mult = SIZE_UNITS[unit];
  if (mult === undefined) throw new QueryError(`Unknown size unit "${m[2]}". Use B, KB, MB, GB or TB.`, pos);
  return Math.round(Number(m[1]) * mult);
}

function parseNumeric(value: string, pos: number, conv: (s: string, pos: number, end?: boolean) => number, period = false): NonNullable<Clause['num']> {
  if (value.includes('..')) {
    const [a, b] = value.split('..');
    if (!a || !b) throw new QueryError('A range needs both ends, e.g. 10MB..1GB.', pos);
    return { op: 'range', a: conv(a, pos), b: conv(b, pos, true) };
  }
  const m = /^(>=|<=|>|<|=)?(.*)$/.exec(value)!;
  const op = (m[1] ?? '=') as '>' | '<' | '>=' | '<=' | '=';
  if (!m[2]) throw new QueryError('Missing value after comparison.', pos);
  // For dates, "=" means "within that day/month/year".
  if (op === '=' && period) return { op: 'range', a: conv(m[2], pos, false), b: conv(m[2], pos, true) };
  return { op, a: conv(m[2], pos, op === '<=' || op === '>') };
}

const DAY = 86400000;

/** Convert a date expression to epoch ms; `end` picks the end of the period for upper bounds. */
export function parseDate(s: string, pos: number, end = false): number {
  const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(s);
  if (!m) throw new QueryError(`"${s}" is not a date. Use YYYY, YYYY-MM or YYYY-MM-DD, or today/yesterday/last7days.`, pos);
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) - 1 : 0;
  const d = m[3] ? Number(m[3]) : 1;
  if (mo < 0 || mo > 11 || d < 1 || d > 31) throw new QueryError(`"${s}" is not a valid date.`, pos);
  const start = new Date(y, mo, d).getTime();
  if (!end) return start;
  if (m[3]) return start + DAY - 1;
  if (m[2]) return new Date(y, mo + 1, 1).getTime() - 1;
  return new Date(y + 1, 0, 1).getTime() - 1;
}

function relativeDate(word: string, nowMs: number): { a: number; b: number } | undefined {
  const today = new Date(nowMs);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const m = /^last(\d+)(days?|weeks?|months?|years?)$/.exec(word);
  if (word === 'today') return { a: startOfToday, b: Infinity };
  if (word === 'yesterday') return { a: startOfToday - DAY, b: startOfToday - 1 };
  if (word === 'thisweek') return { a: startOfToday - ((today.getDay() + 6) % 7) * DAY, b: Infinity };
  if (word === 'thismonth') return { a: new Date(today.getFullYear(), today.getMonth(), 1).getTime(), b: Infinity };
  if (word === 'thisyear') return { a: new Date(today.getFullYear(), 0, 1).getTime(), b: Infinity };
  if (m) {
    const n = Number(m[1]);
    const unit = m[2]!.replace(/s$/, '');
    const days = unit === 'day' ? n : unit === 'week' ? n * 7 : unit === 'month' ? n * 30 : n * 365;
    return { a: nowMs - days * DAY, b: Infinity };
  }
  return undefined;
}

/** Reject regexes likely to backtrack catastrophically; names are ≤255 chars which bounds the rest. */
export function safeRegex(src: string, pos: number): RegExp {
  if (src.length > 200) throw new QueryError('Regular expressions are limited to 200 characters.', pos);
  if (/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/.test(src)) {
    throw new QueryError('This regular expression has nested repetition, which can be extremely slow. Simplify it.', pos);
  }
  if (/\\[1-9]/.test(src)) throw new QueryError('Back-references are not supported in search.', pos);
  try {
    return new RegExp(src, 'i');
  } catch (err) {
    throw new QueryError(`Invalid regular expression: ${(err as Error).message}`, pos);
  }
}

export function wildcardToRegex(pattern: string): RegExp {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, 'i');
}

export function parseQuery(input: string, nowMs = Date.now()): ParsedQuery {
  const tokens = tokenize(input);
  const groups: Clause[][] = [[]];
  let usesContent = false;
  let usesTags = false;
  let usesMeta = false;
  let usesCatalog = false;
  for (const tok of tokens) {
    if (!tok.quoted && tok.text === 'OR') {
      if (!groups[groups.length - 1]!.length) throw new QueryError('"OR" needs a term on both sides.', tok.pos);
      groups.push([]);
      continue;
    }
    let text = tok.text;
    let negate = false;
    if (!tok.quoted && text.startsWith('-') && text.length > 1) {
      negate = true;
      text = text.slice(1);
    }
    const colon = tok.quoted ? -1 : text.indexOf(':');
    const key = colon > 0 ? text.slice(0, colon).toLowerCase() : undefined;
    if (key && KEYS.has(key)) {
      const value = text.slice(colon + 1);
      if (!value) throw new QueryError(`"${key}:" needs a value.`, tok.pos);
      const clause: Clause = { field: key as Field, negate, value: value.toLowerCase() };
      switch (key) {
        case 'type': {
          const v = value.toLowerCase().replace(/^\./, '');
          if (!TYPE_GROUPS[v] && !/^[a-z0-9]{1,12}$/.test(v)) throw new QueryError(`Unknown type "${value}".`, tok.pos);
          clause.value = v;
          break;
        }
        case 'ext':
          clause.value = value.toLowerCase().replace(/^\./, '');
          break;
        case 'is':
          if (!IS_VALUES.has(clause.value)) throw new QueryError(`"is:${value}" is not supported. Use is:file, is:folder, is:link or is:hidden.`, tok.pos);
          break;
        case 'size':
          clause.num = parseNumeric(value, tok.pos, (s, p) => parseSize(s, p));
          break;
        case 'modified':
        case 'created':
        case 'accessed':
        case 'taken': {
          const rel = relativeDate(value.toLowerCase(), nowMs);
          clause.num = rel ? { op: 'range', a: rel.a, b: rel.b } : parseNumeric(value, tok.pos, (s, p, end) => parseDate(s, p, end), true);
          break;
        }
        case 'width':
        case 'height':
          clause.num = parseNumeric(value, tok.pos, (s, p) => parseIntValue(s.replace(/px$/i, ''), p, 'number of pixels'));
          break;
        case 'pages':
          clause.num = parseNumeric(value, tok.pos, (s, p) => parseIntValue(s, p, 'page count'));
          break;
        case 'rating': {
          clause.num = parseNumeric(value, tok.pos, (s, p) => {
            const n = parseIntValue(s, p, 'rating');
            if (n < 0 || n > 5) throw new QueryError('Ratings go from 0 to 5.', p);
            return n;
          });
          break;
        }
        case 'duration':
          clause.num = parseNumeric(value, tok.pos, (s, p) => parseDurationSec(s, p));
          break;
        case 'source':
          if (!SOURCES.has(clause.value)) throw new QueryError(`"source:${value}" is not supported. Use source:download, source:generated or source:import.`, tok.pos);
          break;
        case 'note':
        case 'collection':
        case 'project':
        case 'camera':
        case 'artist':
          break;
        case 'tag':
          usesTags = true;
          clause.value = value;
          break;
        case 'content':
          usesContent = true;
          break;
        case 'regex':
          clause.regex = safeRegex(value, tok.pos);
          break;
      }
      if (META_FIELDS.has(key)) usesMeta = true;
      if (CATALOG_FIELDS.has(key)) usesCatalog = true;
      groups[groups.length - 1]!.push(clause);
      continue;
    }
    // Single letters (e.g. "C:") and non-alphabetic prefixes ("12:30") are treated as plain text.
    if (key && key.length > 1 && /^[a-z]+$/.test(key)) {
      throw new QueryError(`Unknown filter "${key}:". Known filters: ${[...KEYS].join(', ')}.`, tok.pos);
    }
    if (!tok.quoted && text.startsWith('~') && text.length > 1) {
      groups[groups.length - 1]!.push({ field: 'fuzzy', negate, value: text.slice(1).toLowerCase() });
    } else if (!tok.quoted && /[*?]/.test(text)) {
      groups[groups.length - 1]!.push({ field: 'wildcard', negate, value: text, regex: wildcardToRegex(text) });
    } else {
      groups[groups.length - 1]!.push({ field: 'name', negate, value: text.toLowerCase() });
    }
  }
  if (groups.length > 1 && !groups[groups.length - 1]!.length) throw new QueryError('"OR" needs a term on both sides.', input.length);
  return { groups: groups.filter((g) => g.length), usesContent, usesTags, usesMeta, usesCatalog, text: input };
}

export interface Candidate {
  path: string;
  name: string;
  ext: string;
  kind: 'file' | 'directory' | 'symlink' | 'other';
  size?: number;
  modifiedMs?: number;
  createdMs?: number;
  accessedMs?: number;
  content?: string | null;
  /** Where `content` came from: the file's text, or text recognized in an image (OCR). */
  contentSource?: 'file' | 'image-text';
  /** Embedded metadata, loaded only for queries that need it. */
  meta?: { width?: number; height?: number; durationSec?: number; pages?: number; takenAt?: string; camera?: string; artist?: string };
}

/** Damerau-free bounded Levenshtein for fuzzy matching against name tokens. */
export function fuzzyMatch(needle: string, hay: string): boolean {
  if (hay.includes(needle)) return true;
  const maxDist = needle.length <= 4 ? 1 : 2;
  const words = hay.split(/[\s._\-()[\]]+/).filter(Boolean);
  for (const w of [hay, ...words]) {
    for (let start = 0; start <= Math.max(0, w.length - needle.length + maxDist); start++) {
      const seg = w.slice(start, start + needle.length + maxDist);
      if (levenshteinWithin(needle, seg, maxDist)) return true;
    }
  }
  return false;
}

function levenshteinWithin(a: string, b: string, max: number): boolean {
  // Best match of `a` against any prefix of `b`.
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return false;
    prev = cur;
  }
  return Math.min(...prev) <= max;
}

function numMatch(n: number | undefined, spec: NonNullable<Clause['num']>): boolean {
  if (n === undefined) return false;
  switch (spec.op) {
    case '>': return n > spec.a;
    case '<': return n < spec.a;
    case '>=': return n >= spec.a;
    case '<=': return n <= spec.a;
    case '=': return spec.b !== undefined ? n >= spec.a && n <= spec.b : n === spec.a;
    case 'range': return n >= spec.a && n <= (spec.b ?? Infinity);
  }
}

export interface EvalContext {
  tagLookup?: (tagName: string) => Set<string>;
  catalog?: {
    note(path: string): string | undefined;
    rating(path: string): number | undefined;
    sources(path: string): Set<string>;
    inCollection(name: string, path: string): boolean;
    inProject(name: string, path: string): boolean;
  };
  /** Loads embedded metadata for a file (dimensions, duration…); used when the query needs it. */
  metaLookup?: (path: string) => Promise<Candidate['meta'] | undefined>;
  /** Text recognized in an image ("Make text in images searchable"), while the file still has this size and time. */
  imageText?: (path: string, size: number | undefined, mtimeMs: number | undefined) => string | undefined;
}

function takenMs(takenAt: string | undefined): number | undefined {
  if (!takenAt) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(takenAt);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)).getTime();
}

export function clauseMatches(c: Clause, item: Candidate, ctx: EvalContext): boolean {
  const name = item.name.toLowerCase();
  switch (c.field) {
    case 'name': return name.includes(c.value);
    case 'path': return item.path.toLowerCase().includes(c.value);
    case 'ext': return item.ext === c.value;
    case 'type': {
      const group = TYPE_GROUPS[c.value];
      return item.kind !== 'directory' && (group ? group.includes(item.ext) : item.ext === c.value);
    }
    case 'is':
      if (c.value === 'file') return item.kind === 'file';
      if (c.value === 'folder' || c.value === 'dir' || c.value === 'directory') return item.kind === 'directory';
      if (c.value === 'link' || c.value === 'symlink') return item.kind === 'symlink';
      if (c.value === 'hidden') return item.name.startsWith('.');
      return false;
    case 'size': return item.kind === 'file' && numMatch(item.size, c.num!);
    case 'modified': return numMatch(item.modifiedMs, c.num!);
    case 'created': return numMatch(item.createdMs, c.num!);
    case 'accessed': return numMatch(item.accessedMs, c.num!);
    case 'note': return (ctx.catalog?.note(item.path) ?? '').toLowerCase().includes(c.value);
    case 'rating': return numMatch(ctx.catalog?.rating(item.path), c.num!);
    case 'source': return ctx.catalog?.sources(item.path).has(c.value) ?? false;
    case 'collection': return ctx.catalog?.inCollection(c.value, item.path) ?? false;
    case 'project': return ctx.catalog?.inProject(c.value, item.path) ?? false;
    case 'width': return numMatch(item.meta?.width, c.num!);
    case 'height': return numMatch(item.meta?.height, c.num!);
    case 'pages': return numMatch(item.meta?.pages, c.num!);
    case 'duration': return numMatch(item.meta?.durationSec, c.num!);
    case 'taken': return numMatch(takenMs(item.meta?.takenAt), c.num!);
    case 'camera': return (item.meta?.camera ?? '').toLowerCase().includes(c.value);
    case 'artist': return (item.meta?.artist ?? '').toLowerCase().includes(c.value);
    case 'tag': return ctx.tagLookup?.(c.value).has(item.path) ?? false;
    case 'content': return typeof item.content === 'string' && item.content.toLowerCase().includes(c.value);
    case 'regex':
    case 'wildcard': return c.regex!.test(item.name);
    case 'fuzzy': return fuzzyMatch(c.value, name);
  }
}

export function matches(q: ParsedQuery, item: Candidate, ctx: EvalContext = {}): boolean {
  if (!q.groups.length) return false;
  return q.groups.some((g) => g.every((c) => clauseMatches(c, item, ctx) !== c.negate));
}
