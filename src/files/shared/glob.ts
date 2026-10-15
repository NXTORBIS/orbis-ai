/**
 * Small glob matcher for include/exclude filters (duplicates, storage).
 *
 * - `*` matches any run of characters except `/`; `**` matches across folders;
 *   `?` one character; `[abc]` / `[!abc]` a character class; `{a,b}` alternatives.
 * - A pattern without `/` is matched against the item's name only
 *   (`*.tmp`, `Thumbs.db`); a pattern with `/` is matched against the path
 *   relative to the scanned folder, with `/` separators (`photos/**\/*.jpg`).
 * - Matching is case-insensitive unless asked otherwise.
 *
 * Patterns are length-limited and compiled once, so a filter list cannot be
 * used to make the scan slow.
 */

export const GLOB_MAX_LENGTH = 512;

export interface CompiledGlob {
  source: string;
  /** True when the pattern contains `/` and is matched against the relative path. */
  pathPattern: boolean;
  test(relPath: string, name: string): boolean;
}

export class GlobError extends Error {}

function escapeRe(c: string): string {
  return /[.+^${}()|[\]\\*?]/.test(c) ? `\\${c}` : c;
}

export function compileGlob(pattern: string, opts: { caseSensitive?: boolean } = {}): CompiledGlob {
  const src = pattern.trim().replace(/\\/g, '/');
  if (!src) throw new GlobError('Empty pattern.');
  if (src.length > GLOB_MAX_LENGTH) throw new GlobError(`Patterns are limited to ${GLOB_MAX_LENGTH} characters.`);
  if ((src.match(/\*/g)?.length ?? 0) > 24) throw new GlobError('Too many "*" in one pattern.');
  const pathPattern = src.includes('/');
  const body = src.replace(/^\/+/, '');
  let re = '';
  let braces = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === '*') {
      if (body[i + 1] === '*') {
        // `**/` matches zero or more folders; a trailing `**` matches everything below.
        if (body[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = body.indexOf(']', i + 2);
      if (end < 0) {
        re += '\\[';
        continue;
      }
      let cls = body.slice(i + 1, end);
      const negate = cls.startsWith('!') || cls.startsWith('^');
      if (negate) cls = cls.slice(1);
      re += `[${negate ? '^' : ''}${cls.replace(/[\\\]^]/g, (m) => `\\${m}`)}]`;
      i = end;
    } else if (c === '{') {
      braces++;
      re += '(?:';
    } else if (c === '}' && braces > 0) {
      braces--;
      re += ')';
    } else if (c === ',' && braces > 0) re += '|';
    else re += escapeRe(c);
  }
  if (braces > 0) throw new GlobError('Unclosed "{" in pattern.');
  let rx: RegExp;
  try {
    rx = new RegExp(`^${re}$`, opts.caseSensitive ? '' : 'i');
  } catch {
    throw new GlobError(`"${pattern}" is not a valid pattern.`);
  }
  return {
    source: pattern,
    pathPattern,
    test: (relPath, name) => rx.test(pathPattern ? relPath.replace(/\\/g, '/') : name),
  };
}

/** Compile a list of patterns; invalid ones are reported, not silently dropped. */
export function compileGlobs(patterns: string[], opts: { caseSensitive?: boolean } = {}): { globs: CompiledGlob[]; errors: string[] } {
  const globs: CompiledGlob[] = [];
  const errors: string[] = [];
  for (const p of patterns) {
    if (!p.trim()) continue;
    try {
      globs.push(compileGlob(p, opts));
    } catch (err) {
      errors.push(`${p}: ${(err as Error).message}`);
    }
  }
  return { globs, errors };
}

/** Split a user-typed list ("*.jpg, *.png" or one per line) into patterns. */
export function splitPatterns(text: string): string[] {
  return text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
}

export function matchesAny(globs: CompiledGlob[], relPath: string, name: string): boolean {
  for (const g of globs) if (g.test(relPath, name)) return true;
  return false;
}
