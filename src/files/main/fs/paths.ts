import path from 'node:path';
import os from 'node:os';
import { makeError } from '../../shared/errors';

/**
 * Path and filename rules. All path work uses node:path for the running
 * platform; nothing here concatenates path strings by hand.
 */

const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

export interface NameCheck {
  valid: boolean;
  reason?: string;
}

/** Validate a single path segment (file or folder name) for a platform. */
export function validateName(name: string, platform: NodeJS.Platform = process.platform): NameCheck {
  if (name.length === 0) return { valid: false, reason: 'The name cannot be empty.' };
  if (name.trim().length === 0) return { valid: false, reason: 'The name cannot be only spaces.' };
  if (name === '.' || name === '..') return { valid: false, reason: 'This name is reserved.' };
  if (name.includes('\0')) return { valid: false, reason: 'The name contains a null character.' };
  if (Buffer.byteLength(name, 'utf8') > 255) return { valid: false, reason: 'The name is longer than 255 bytes.' };
  if (name.includes('/')) return { valid: false, reason: 'The name cannot contain "/".' };
  if (platform === 'win32') {
    if (/[<>:"\\|?*\x00-\x1f]/.test(name)) return { valid: false, reason: 'The name cannot contain < > : " \\ | ? * or control characters.' };
    if (/[ .]$/.test(name)) return { valid: false, reason: 'The name cannot end with a space or a period on Windows.' };
    const stem = name.split('.')[0]!.toUpperCase();
    if (WINDOWS_RESERVED.has(stem)) return { valid: false, reason: `"${stem}" is a reserved name on Windows.` };
  }
  if (platform === 'darwin' && name.includes(':')) return { valid: false, reason: 'The name cannot contain ":" on macOS.' };
  return { valid: true };
}

/** Join a parent directory and a validated name; rejects names that would escape the parent. */
export function childPath(parent: string, name: string, operation: string): string {
  const check = validateName(name);
  if (!check.valid) throw makeError('invalid_name', operation, { message: check.reason, target: name });
  const resolvedParent = path.resolve(parent);
  const joined = path.resolve(resolvedParent, name);
  if (path.dirname(joined) !== resolvedParent) {
    throw makeError('invalid_name', operation, { message: 'The name would place the item outside its folder.', target: name });
  }
  return joined;
}

/** Normalise an absolute path coming across IPC. Relative paths are rejected. */
export function requireAbsolute(p: string, operation: string): string {
  if (p.includes('\0')) throw makeError('invalid_path', operation, { message: 'The path contains a null character.' });
  if (!path.isAbsolute(p)) throw makeError('invalid_path', operation, { message: 'Expected an absolute path.', target: p });
  return path.resolve(p);
}

/** True when `child` is `parent` or inside it (after resolution, platform-aware case handling). */
export function isWithin(parent: string, child: string, caseInsensitive = process.platform === 'win32'): boolean {
  let p = path.resolve(parent);
  let c = path.resolve(child);
  if (caseInsensitive) {
    p = p.toLowerCase();
    c = c.toLowerCase();
  }
  if (p === c) return true;
  const rel = path.relative(p, c);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Expand "~" and environment-style home references for typed address input. */
export function expandUserInput(input: string, base?: string): string {
  let s = input.trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) s = s.slice(1, -1);
  if (s.startsWith('file://')) {
    try {
      s = decodeURIComponent(new URL(s).pathname);
      if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(s)) s = s.slice(1);
    } catch {
      /* fall through with the original text */
    }
  }
  if (s === '~') return os.homedir();
  if (s.startsWith('~/') || s.startsWith('~\\')) return path.join(os.homedir(), s.slice(2));
  if (!path.isAbsolute(s) && base) return path.resolve(base, s);
  return path.resolve(s);
}

/** Split a name into stem and extension. Dotfiles have no extension. */
export function splitExt(name: string): { stem: string; ext: string } {
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return { stem: name, ext: '' };
  return { stem: name.slice(0, idx), ext: name.slice(idx) };
}

/**
 * Produce a non-colliding "keep both" name, e.g. "report (2).pdf".
 * `exists` is called for each candidate; the caller re-checks at commit time.
 */
export async function uniqueName(dir: string, name: string, exists: (p: string) => Promise<boolean>): Promise<string> {
  const { stem, ext } = splitExt(name);
  const base = stem.replace(/ \((\d+)\)$/, '');
  for (let n = 2; n < 100000; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!(await exists(path.join(dir, candidate)))) return candidate;
  }
  throw makeError('already_exists', 'fs.uniqueName', { message: 'Could not find a free name.' });
}

/** Breadcrumb segments for an absolute path. */
export function pathSegments(p: string): Array<{ name: string; path: string }> {
  const resolved = path.resolve(p);
  const root = path.parse(resolved).root;
  const rest = resolved.slice(root.length).split(path.sep).filter(Boolean);
  const out = [{ name: root, path: root }];
  let acc = root;
  for (const part of rest) {
    acc = path.join(acc, part);
    out.push({ name: part, path: acc });
  }
  return out;
}
