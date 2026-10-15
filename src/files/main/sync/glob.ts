import { makeError } from '../../shared/errors';

/**
 * Include/exclude patterns for folder synchronization (a small subset of
 * .gitignore syntax, matched against '/'-separated relative paths):
 *
 *   *.tmp          a name anywhere (no '/' in the pattern: matched against the name)
 *   build/         a folder with that name anywhere (trailing '/': folders only)
 *   docs/*.md      anchored at the synchronized folder (any '/' in the pattern)
 *   **             any number of folders; '*' any characters except '/'; '?' one character
 *   [abc] [!abc]   character classes
 *
 * A folder that matches an exclude pattern is left alone with everything in it.
 * When include patterns exist, files must match one (or lie inside a matching folder).
 */

export interface CompiledPattern {
  source: string;
  re: RegExp;
  dirOnly: boolean;
  anchored: boolean;
}

export function compilePattern(glob: string, caseInsensitive: boolean): CompiledPattern {
  let g = glob.trim();
  const dirOnly = g.endsWith('/');
  if (dirOnly) g = g.replace(/\/+$/, '');
  const anchored = g.includes('/');
  g = g.replace(/^\/+/, '');
  let body = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') {
          body += '(?:.*/)?';
          i += 2;
        } else {
          body += '.*';
          i += 1;
        }
      } else body += '[^/]*';
    } else if (c === '?') body += '[^/]';
    else if (c === '[') {
      const close = g.indexOf(']', i + 2);
      if (close < 0) {
        body += '\\[';
        continue;
      }
      let cls = g.slice(i + 1, close);
      const negate = cls.startsWith('!') || cls.startsWith('^');
      if (negate) cls = cls.slice(1);
      cls = cls.replace(/[\\\]^]/g, '\\$&');
      body += negate ? `[^/${cls}]` : `[${cls}]`;
      i = close;
    } else body += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  let re: RegExp;
  try {
    re = new RegExp(`^${body}$`, caseInsensitive ? 'iu' : 'u');
  } catch {
    throw makeError('validation', 'sync.pattern', { message: `The pattern “${glob}” is not valid.` });
  }
  return { source: glob, re, dirOnly, anchored };
}

export function matches(p: CompiledPattern, rel: string, name: string, isDir: boolean): boolean {
  if (p.dirOnly && !isDir) return false;
  return p.re.test(p.anchored ? rel : name);
}

export interface PathFilter {
  /** 'out' = leave alone (with everything inside), 'in' = in scope, 'pass' = folder not itself in scope but searched for included items. */
  check(rel: string, name: string, isDir: boolean, parentIncluded: boolean): 'out' | 'in' | 'pass';
}

export function makeFilter(include: string[], exclude: string[], caseInsensitive: boolean): PathFilter {
  const inc = include.map((g) => compilePattern(g, caseInsensitive));
  const exc = exclude.map((g) => compilePattern(g, caseInsensitive));
  return {
    check(rel, name, isDir, parentIncluded) {
      if (exc.some((p) => matches(p, rel, name, isDir))) return 'out';
      if (!inc.length || parentIncluded) return 'in';
      if (inc.some((p) => matches(p, rel, name, isDir))) return 'in';
      return isDir ? 'pass' : 'out';
    },
  };
}
