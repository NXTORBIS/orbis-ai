import path from 'node:path';

/**
 * Orbis Files is a file explorer for Orbis's own folder only. Everything it can read or change lives under one
 * root; a request that names anything outside it is refused here, in the main process, rather than merely hidden
 * in the window.
 */
let root = '';
let orbisOnly = false;

export function setOrbisOnly(on: boolean): void {
  orbisOnly = on;
}

export function isOrbisOnly(): boolean {
  return orbisOnly;
}

export function setLibraryRoot(dir: string): void {
  root = path.resolve(dir);
}

export function libraryRoot(): string {
  return root;
}

/** Channels that reach outside Orbis (other machines, the system's drives, a shell that could go anywhere). */
/** Never available: they reach other machines, which Orbis Files does not do. */
const ALWAYS_BLOCKED = [/^remote:/, /^s3:/, /^cloud:/, /^share:/];
/** Blocked only in Orbis-only mode: a shell and the system pickers could go anywhere. */
const BLOCKED = [/^term:/];
const BLOCKED_EXACT = new Set(['fs:openTerminal', 'fs:terminalInfo', 'fs:pickDirectory', 'fs:pickFile']);

/** Channels answered with an empty value instead of an error, so the screen that asks simply shows nothing. */
const EMPTY: Record<string, unknown> = {
  'fs:volumes': [],
  'volumes:snapshot': { volumes: [], takenMs: 0 },
};

/** Fields that hold a path. A free-text field is never checked, so a search for "/etc" is not a path. */
const PATH_WORDS = 'path|paths|dir|dirs|folder|folders|root|roots|from|to|dest|destination|src|source|target|cwd|file|files|parent|base|left|right|origin|output|location|input';
const PATH_KEY = new RegExp(`^(${PATH_WORDS})$|[a-z](${PATH_WORDS.split('|').map((w) => w[0]!.toUpperCase() + w.slice(1)).join('|')})$`);

const looksAbsolute = (s: string): boolean => /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('\\\\') || s.startsWith('/');

export function isInsideLibrary(p: string): boolean {
  if (!root) return false;
  const rel = path.relative(root, path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function firstOutside(value: unknown, key: string): string | undefined {
  if (typeof value === 'string') {
    return PATH_KEY.test(key) && looksAbsolute(value) && !isInsideLibrary(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = firstOutside(v, key);
      if (hit) return hit;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const hit = firstOutside(v, k);
      if (hit) return hit;
    }
  }
  return undefined;
}

export type ScopeVerdict = { kind: 'ok' } | { kind: 'empty'; value: unknown } | { kind: 'refused'; message: string };

export function checkScope(channel: string, payload: unknown): ScopeVerdict {
  if (ALWAYS_BLOCKED.some((re) => re.test(channel))) {
    return { kind: 'refused', message: 'This is not available in Orbis Files.' };
  }
  if (!orbisOnly) return { kind: 'ok' };
  if (channel in EMPTY) return { kind: 'empty', value: EMPTY[channel] };
  if (BLOCKED_EXACT.has(channel) || BLOCKED.some((re) => re.test(channel))) {
    return { kind: 'refused', message: 'This is not available in Orbis Files, which only works with Orbis’s own files.' };
  }
  const outside = firstOutside(payload, '');
  if (outside) return { kind: 'refused', message: 'Orbis Files only works inside Orbis’s own folder. Use “Add to Orbis” to bring a file in.' };
  return { kind: 'ok' };
}
