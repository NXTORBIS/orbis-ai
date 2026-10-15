import { z } from 'zod';

/**
 * Find & replace in files: the query, matching and replacement rules shared by
 * the main process (search, preview, apply) and the UI (validation, inline
 * replacement preview). Matching is deterministic, so a match is identified by
 * its position in the file's list of matches as long as the file is unchanged
 * (checked by SHA-256 before anything is written).
 */

export const FIND_TEXT_MAX = 1000;
export const REPLACE_TEXT_MAX = 10_000;
/** Files larger than this are not searched (reported as skipped). */
export const FIND_MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Matches listed per file; more are counted but not offered for replacement. */
export const FIND_MAX_MATCHES_PER_FILE = 2000;
/** Matches listed in total. */
export const FIND_MAX_MATCHES_TOTAL = 20_000;

export const FindQuerySchema = z.object({
  text: z.string().min(1).max(FIND_TEXT_MAX),
  regex: z.boolean(),
  caseSensitive: z.boolean(),
  wholeWord: z.boolean(),
});
export type FindQuery = z.infer<typeof FindQuerySchema>;

export type Matcher = { ok: true; re: RegExp } | { ok: false; error: string };

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Refuse expressions that are likely to take extremely long (a repetition that repeats). */
export function regexProblem(src: string): string | undefined {
  if (src.length > FIND_TEXT_MAX) return `Expressions are limited to ${FIND_TEXT_MAX} characters.`;
  if (/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/.test(src)) return 'This expression repeats a repetition (like (a+)+), which can take extremely long. Simplify it.';
  return undefined;
}

/**
 * Compile the query into a global regular expression. Plain text is matched
 * literally; "whole word" means the match is not touching a letter, digit or
 * underscore on either side.
 */
export function buildMatcher(q: FindQuery): Matcher {
  if (!q.text) return { ok: false, error: 'Enter text to find.' };
  const body = q.regex ? q.text : escapeRegex(q.text);
  if (q.regex) {
    const p = regexProblem(q.text);
    if (p) return { ok: false, error: p };
  }
  const flags = `g${q.caseSensitive ? '' : 'i'}`;
  const tryCompile = (unicode: boolean): RegExp | string => {
    const b = q.wholeWord ? (unicode ? `(?<![\\p{L}\\p{N}_])(?:${body})(?![\\p{L}\\p{N}_])` : `(?<![\\w])(?:${body})(?![\\w])`) : body;
    try {
      return new RegExp(b, flags + (unicode ? 'u' : ''));
    } catch (err) {
      return (err as Error).message;
    }
  };
  let re = tryCompile(true);
  // Some ordinary expressions are only valid outside Unicode mode (e.g. "\-" or "{" on its own).
  if (typeof re === 'string' && q.regex) re = tryCompile(false);
  if (typeof re === 'string') return { ok: false, error: `This is not a valid regular expression: ${re.replace(/^Invalid regular expression: /, '')}` };
  if (re.test('')) return { ok: false, error: 'This expression also matches empty text. Make it match at least one character.' };
  re.lastIndex = 0;
  return { ok: true, re };
}

export interface RawMatch {
  /** Character offset in the decoded text. */
  index: number;
  /** Matched text. */
  text: string;
  /** Capture groups ($1…); undefined when a group did not take part. */
  captures: Array<string | undefined>;
  groups?: Record<string, string | undefined>;
}

/**
 * All non-empty matches in order (zero-length matches are stepped over, so a
 * replacement never inserts text between characters). Stops after `limit`
 * listed matches but keeps counting up to `countLimit`.
 */
export function findMatches(text: string, re: RegExp, limit = Number.POSITIVE_INFINITY, countLimit = 1_000_000): { matches: RawMatch[]; total: number } {
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const matches: RawMatch[] = [];
  let total = 0;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    if (m[0].length === 0) {
      rx.lastIndex = advance(text, rx.lastIndex, rx.flags.includes('u'));
      continue;
    }
    total++;
    if (matches.length < limit) matches.push({ index: m.index, text: m[0], captures: m.slice(1), groups: m.groups ? { ...m.groups } : undefined });
    if (total >= countLimit) break;
  }
  return { matches, total };
}

function advance(text: string, i: number, unicode: boolean): number {
  if (unicode && i < text.length) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) return i + 2;
  }
  return i + 1;
}

/**
 * The replacement for one match. Plain mode inserts the text as typed.
 * Regular-expression mode follows JavaScript's rules: $1–$99, $<name>, $& (the
 * match), $` and $' (text before/after, needs `input`), $$ (a dollar sign).
 */
export function expandReplacement(template: string, m: RawMatch, regex: boolean, input?: string): string {
  if (!regex) return template;
  let out = '';
  for (let i = 0; i < template.length; i++) {
    const c = template[i]!;
    if (c !== '$' || i + 1 >= template.length) {
      out += c;
      continue;
    }
    const n = template[i + 1]!;
    if (n === '$') { out += '$'; i++; continue; }
    if (n === '&') { out += m.text; i++; continue; }
    if (n === '`') { out += input !== undefined ? input.slice(0, m.index) : ''; i++; continue; }
    if (n === "'") { out += input !== undefined ? input.slice(m.index + m.text.length) : ''; i++; continue; }
    if (n === '<' && m.groups) {
      const end = template.indexOf('>', i + 2);
      if (end > 0) {
        out += m.groups[template.slice(i + 2, end)] ?? '';
        i = end;
        continue;
      }
    }
    if (/[0-9]/.test(n)) {
      // Two digits when that group exists, else one digit, else literal.
      const two = template.slice(i + 1, i + 3);
      if (/^[0-9]{2}$/.test(two) && Number(two) >= 1 && Number(two) <= m.captures.length) {
        out += m.captures[Number(two) - 1] ?? '';
        i += 2;
        continue;
      }
      if (Number(n) >= 1 && Number(n) <= m.captures.length) {
        out += m.captures[Number(n) - 1] ?? '';
        i++;
        continue;
      }
    }
    out += c;
  }
  return out;
}

/** Whether a template uses $` or $' (which need the whole text to show). */
export const usesContextTokens = (template: string) => /\$[`']/.test(template.replace(/\$\$/g, ''));

/**
 * Replace the chosen matches (by their position in `findMatches` order).
 * Returns the new text and how many were replaced.
 */
export function applyReplacements(text: string, re: RegExp, chosen: ReadonlySet<number>, template: string, regex: boolean): { text: string; replaced: number } {
  const { matches } = findMatches(text, re);
  let out = '';
  let last = 0;
  let replaced = 0;
  matches.forEach((m, i) => {
    if (!chosen.has(i)) return;
    out += text.slice(last, m.index) + expandReplacement(template, m, regex, text);
    last = m.index + m.text.length;
    replaced++;
  });
  return { text: out + text.slice(last), replaced };
}

/** Start offsets of every line (after \n, \r\n or a lone \r). */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) starts.push(i + 1);
    else if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) i++;
      starts.push(i + 1);
    }
  }
  return starts;
}

/** 0-based line of a character offset. */
export function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** A listed match with its line context, as sent to the UI. */
export interface MatchInfo {
  /** Position in the file's match list (identifies the match for replacement). */
  i: number;
  /** 1-based line and column (in characters). */
  line: number;
  column: number;
  text: string;
  /** The line holding the match (shortened around it when long), with the match at [start, end). */
  lineText: string;
  start: number;
  end: number;
  /** The match spans more than one line (only the first is shown). */
  multiline?: boolean;
  captures: Array<string | undefined>;
  groups?: Record<string, string | undefined>;
}

export interface FileMatches {
  path: string;
  rel: string;
  size: number;
  mtimeMs: number;
  /** SHA-256 of the bytes searched; the file must still have it when replacing. */
  sha256: string;
  encoding: 'utf8' | 'utf16le' | 'utf16be' | 'latin1' | 'windows1252';
  bom: boolean;
  matches: MatchInfo[];
  /** Matches in the file (more than listed when `truncated`). */
  total: number;
  truncated: boolean;
}

export interface FindReport {
  root: string;
  files: FileMatches[];
  totalMatches: number;
  filesSearched: number;
  skipped: { binary: number; tooLarge: number; unreadable: number; excluded: number; links: number };
  /** The search stopped early (match limit or cancelled). */
  partial: boolean;
  limitReached: boolean;
  /** Pattern problems (invalid include/exclude patterns). */
  notes: string[];
}

export const FindRequestSchema = z.object({
  root: z.string().min(1).max(32767),
  query: FindQuerySchema,
  include: z.array(z.string().min(1).max(512)).max(100),
  exclude: z.array(z.string().min(1).max(512)).max(100),
  skipHidden: z.boolean(),
});
export type FindRequest = z.infer<typeof FindRequestSchema>;

/** One file chosen for replacement: the hash it had in the search and the matches to replace. */
export const ReplaceFileSchema = z.object({
  path: z.string().min(1).max(32767),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  matches: z.array(z.number().int().min(0).max(FIND_MAX_MATCHES_PER_FILE)).min(1).max(FIND_MAX_MATCHES_PER_FILE),
});
export type ReplaceFile = z.infer<typeof ReplaceFileSchema>;

export const ReplaceParamsSchema = z.object({
  query: FindQuerySchema,
  replacement: z.string().max(REPLACE_TEXT_MAX),
  files: z.array(ReplaceFileSchema).min(1).max(20_000),
});
export type ReplaceParams = z.infer<typeof ReplaceParamsSchema>;

/** A line diff of one file for the replace preview. */
export interface DiffLine { kind: 'same' | 'add' | 'del' | 'gap'; text: string; oldLine?: number; newLine?: number }
export interface ReplacePreview {
  path: string;
  ok: boolean;
  /** Why no diff is shown (changed since the search, cannot encode the new text…). */
  problem?: string;
  replaced: number;
  lines: DiffLine[];
  /** The diff was longer than shown. */
  clipped: boolean;
}
