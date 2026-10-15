import path from 'node:path';

/**
 * Parse an orbis-media:// or orbis-thumb:// URL into an absolute local path.
 * Returns undefined for anything that is not a clean absolute path.
 */
export function pathFromPreviewUrl(url: string, platform: NodeJS.Platform = process.platform): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'orbis-media:' && u.protocol !== 'orbis-thumb:') return undefined;
  let p: string;
  try {
    // The renderer encodes the whole absolute path as one segment; decode, then root it exactly once.
    p = decodeURIComponent(u.pathname).replace(/^\/+/, platform === 'win32' ? '' : '/');
  } catch {
    return undefined;
  }
  if (!p || p.includes('\0')) return undefined;
  const abs = platform === 'win32' ? path.win32.isAbsolute(p) : path.posix.isAbsolute(p);
  if (!abs) return undefined;
  // Normalised form must equal the input: rejects "..", "." and duplicate separators.
  const norm = platform === 'win32' ? path.win32.normalize(p) : path.posix.normalize(p);
  return norm === p ? p : undefined;
}

/** IPC requests are only honoured from the app's own renderer pages. */
export function isTrustedSenderUrl(url: string | undefined, rendererDirUrl: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const base = new URL(rendererDirUrl);
    return u.protocol === 'file:' && base.protocol === 'file:' && decodeURIComponent(u.pathname).startsWith(decodeURIComponent(base.pathname)) && !decodeURIComponent(u.pathname).includes('/../');
  } catch {
    return false;
  }
}
