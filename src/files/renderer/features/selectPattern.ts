import type { FileEntry } from '../../shared/model';
import { categoryOfEntry, type Category } from '../ui/format';

/**
 * "Select by pattern…": choose items in the current folder by a wildcard
 * pattern, a regular expression, or their type/extension. Pure functions;
 * the dialog shows how many items match before anything is selected.
 */

export type PatternMode = 'glob' | 'regex' | 'type';
export type SelectOp = 'replace' | 'add' | 'remove';

export interface PatternSpec {
  mode: PatternMode;
  /** glob: patterns separated by ";"; regex: one expression; type: extensions separated by spaces, commas or ";" */
  pattern: string;
  caseSensitive?: boolean;
  /** Whether folders can match (glob/regex). Type mode matches folders only through the "folder" category. */
  includeFolders?: boolean;
  /** Type mode: categories (image, video, audio, document, …, folder). */
  categories?: Category[];
}

export type Compiled = { ok: true; test: (e: Pick<FileEntry, 'name' | 'kind' | 'ext' | 'linkTargetKind'>) => boolean } | { ok: false; reason: string };

const isDir = (e: Pick<FileEntry, 'kind' | 'linkTargetKind'>) => e.kind === 'directory' || (e.kind === 'symlink' && e.linkTargetKind === 'directory');

/**
 * A wildcard pattern as a regular expression for the whole name:
 * `*` any run of characters, `?` one character, `[abc]` / `[a-z]` / `[!abc]` a set.
 * Everything else is literal.
 */
export function globToRegExp(glob: string, caseSensitive = false): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 2);
      if (end < 0) {
        re += '\\[';
        continue;
      }
      let body = glob.slice(i + 1, end);
      const negate = body.startsWith('!') || body.startsWith('^');
      if (negate) body = body.slice(1);
      re += `[${negate ? '^' : ''}${body.replace(/[\\\]^]/g, '\\$&')}]`;
      i = end;
    } else re += c.replace(/[.+^${}()|\\/\]]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, caseSensitive ? 'u' : 'iu');
}

/** Refuse regular expressions that are likely to be extremely slow (nested repetition, back-references). */
export function checkRegex(src: string): string | undefined {
  if (src.length > 200) return 'Regular expressions are limited to 200 characters.';
  if (/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/.test(src)) return 'This expression repeats a repetition, which can be extremely slow. Simplify it.';
  if (/\\[1-9]/.test(src)) return 'Back-references are not supported.';
  return undefined;
}

export function parseExtensions(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((x) => x.trim().replace(/^\*?\./, '').toLowerCase()).filter(Boolean))];
}

export function compilePattern(spec: PatternSpec): Compiled {
  const folders = !!spec.includeFolders;
  if (spec.mode === 'type') {
    const exts = new Set(parseExtensions(spec.pattern));
    const cats = new Set(spec.categories ?? []);
    if (!exts.size && !cats.size) return { ok: false, reason: 'Enter one or more extensions or choose a type.' };
    return {
      ok: true,
      test: (e) => {
        const cat = categoryOfEntry(e);
        if (isDir(e)) return cats.has('folder');
        return exts.has(e.ext.toLowerCase()) || cats.has(cat);
      },
    };
  }
  if (!spec.pattern.trim()) return { ok: false, reason: spec.mode === 'glob' ? 'Enter a pattern such as *.jpg or report-??.pdf.' : 'Enter a regular expression.' };
  let res: RegExp[];
  if (spec.mode === 'glob') {
    res = spec.pattern.split(';').map((p) => p.trim()).filter(Boolean).map((p) => globToRegExp(p, spec.caseSensitive));
  } else {
    const bad = checkRegex(spec.pattern);
    if (bad) return { ok: false, reason: bad };
    try {
      res = [new RegExp(spec.pattern, spec.caseSensitive ? 'u' : 'iu')];
    } catch (err) {
      return { ok: false, reason: `Not a valid regular expression: ${(err as Error).message.replace(/^Invalid regular expression: /, '')}` };
    }
  }
  return { ok: true, test: (e) => (folders || !isDir(e)) && res.some((r) => r.test(e.name)) };
}

/** The paths of `entries` that match. */
export function matchingPaths(entries: FileEntry[], spec: PatternSpec): { ok: true; paths: string[] } | { ok: false; reason: string } {
  const c = compilePattern(spec);
  if (!c.ok) return c;
  return { ok: true, paths: entries.filter((e) => c.test(e)).map((e) => e.path) };
}

/** Combine the matches with the current selection (kept in listing order). */
export function combineSelection(entries: FileEntry[], current: string[], matches: string[], op: SelectOp): string[] {
  const m = new Set(matches);
  const cur = new Set(current);
  if (op === 'replace') return entries.filter((e) => m.has(e.path)).map((e) => e.path);
  if (op === 'add') return entries.filter((e) => cur.has(e.path) || m.has(e.path)).map((e) => e.path);
  return entries.filter((e) => cur.has(e.path) && !m.has(e.path)).map((e) => e.path);
}

/**
 * "Select items of the same type": every item with an extension that a
 * selected file has (files without an extension match each other), plus all
 * folders when a folder is selected.
 */
export function sameTypePaths(entries: FileEntry[], selection: string[]): string[] {
  const sel = new Set(selection);
  const chosen = entries.filter((e) => sel.has(e.path));
  const exts = new Set(chosen.filter((e) => !isDir(e)).map((e) => e.ext.toLowerCase()));
  const folders = chosen.some(isDir);
  return entries.filter((e) => (isDir(e) ? folders : exts.has(e.ext.toLowerCase()))).map((e) => e.path);
}

export const TYPE_CHOICES: Array<{ value: Category; label: string }> = [
  { value: 'image', label: 'Images' }, { value: 'video', label: 'Videos' }, { value: 'audio', label: 'Audio' },
  { value: 'document', label: 'Documents' }, { value: 'pdf', label: 'PDF' }, { value: 'spreadsheet', label: 'Spreadsheets' },
  { value: 'presentation', label: 'Presentations' }, { value: 'text', label: 'Text' }, { value: 'code', label: 'Code' },
  { value: 'archive', label: 'Archives' }, { value: 'executable', label: 'Programs' }, { value: 'folder', label: 'Folders' },
];
