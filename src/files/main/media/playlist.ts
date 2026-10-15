import path from 'node:path';

/**
 * Playlist files: M3U / M3U8 (extended with #EXTINF) and PLS, read and written
 * without touching the disk (main/media/player.ts does the I/O). Entries keep
 * their order; entries that cannot be used (web addresses, paths for another
 * system) are returned with a problem instead of being dropped.
 */

export interface PlaylistEntry {
  /** As written in the playlist. */
  raw: string;
  /** Absolute local path, when the entry names a local file. */
  path?: string;
  /** Another spelling to try when `path` does not exist (a Windows-style relative path on Linux/macOS). */
  alternative?: string;
  title?: string;
  durationSec?: number;
  /** Why the entry cannot be played at all (independent of whether the file exists). */
  problem?: string;
}

type Platform = NodeJS.Platform;
const pathFor = (platform: Platform) => (platform === 'win32' ? path.win32 : path.posix);

/** Playlist bytes as text: UTF-8 (with or without BOM) when valid, UTF-16 with a BOM, otherwise Windows-1252 (old .m3u files). */
export function decodePlaylist(buf: Uint8Array): string {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return new TextDecoder('utf-8').decode(buf.subarray(3));
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/** A file:// URL as a local path ("file:///C:/x" on Windows, "file:///x" elsewhere; host "localhost" accepted). */
export function fileUrlToPath(url: string, platform: Platform = process.platform): string | undefined {
  const m = /^file:\/\/([^/]*)(\/.*)$/i.exec(url);
  if (!m) return undefined;
  const host = m[1]!.toLowerCase();
  let p: string;
  try {
    p = decodeURIComponent(m[2]!);
  } catch {
    return undefined;
  }
  if (p.includes('\0')) return undefined;
  if (platform === 'win32') {
    if (host && host !== 'localhost') return `\\\\${host}${p.replace(/\//g, '\\')}`;
    return /^\/[A-Za-z]:/.test(p) ? p.slice(1).replace(/\//g, '\\') : undefined;
  }
  if (host && host !== 'localhost') return undefined;
  return p;
}

const WINDOWS_ABS = /^([A-Za-z]:[\\/]|\\\\)/;

/** Resolve one entry against the playlist's folder. */
export function resolveEntry(raw: string, baseDir: string, platform: Platform = process.platform): Pick<PlaylistEntry, 'path' | 'alternative' | 'problem'> {
  const P = pathFor(platform);
  const s = raw.trim();
  if (!s) return { problem: 'Empty entry.' };
  if (/^file:/i.test(s)) {
    const p = fileUrlToPath(s, platform);
    return p ? { path: P.normalize(p) } : { problem: 'This file link does not point to a file on this computer.' };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return { problem: 'Web addresses and streams are not played by Orbis Files; only files on this computer are.' };
  if (platform !== 'win32' && WINDOWS_ABS.test(s)) return { path: s, problem: 'This is a Windows path; it cannot be found on this computer.' };
  if (P.isAbsolute(s)) return { path: P.normalize(s) };
  const primary = P.normalize(P.join(baseDir, s));
  // Playlists made on Windows use backslashes; on other systems a backslash can also be part of a name, so both are tried.
  const alternative = platform !== 'win32' && s.includes('\\') ? P.normalize(P.join(baseDir, s.replace(/\\/g, '/'))) : undefined;
  return alternative && alternative !== primary ? { path: primary, alternative } : { path: primary };
}

/** Parse M3U or extended M3U(8). `#EXTINF:<seconds>,<title>` applies to the next entry; other comments are ignored. */
export function parseM3u(text: string, baseDir: string, platform: Platform = process.platform): PlaylistEntry[] {
  const out: PlaylistEntry[] = [];
  let pending: { title?: string; durationSec?: number } = {};
  for (const line0 of text.split(/\r\n|\r|\n/)) {
    const line = line0.replace(/^\uFEFF/, '').trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const m = /^#EXTINF:\s*(-?\d+(?:\.\d+)?)?[^,]*,(.*)$/i.exec(line);
      if (m) {
        const d = m[1] !== undefined ? Number(m[1]) : NaN;
        pending = { title: m[2]!.trim() || undefined, durationSec: Number.isFinite(d) && d >= 0 ? d : undefined };
      }
      continue;
    }
    out.push({ raw: line, ...resolveEntry(line, baseDir, platform), ...(pending.title ? { title: pending.title } : {}), ...(pending.durationSec !== undefined ? { durationSec: pending.durationSec } : {}) });
    pending = {};
  }
  return out;
}

/** Parse PLS: FileN=, TitleN=, LengthN= in N order (keys are case-insensitive; gaps are fine). */
export function parsePls(text: string, baseDir: string, platform: Platform = process.platform): PlaylistEntry[] {
  const files = new Map<number, { file?: string; title?: string; length?: number }>();
  for (const line0 of text.split(/\r\n|\r|\n/)) {
    const m = /^\s*(File|Title|Length)(\d+)\s*=(.*)$/i.exec(line0);
    if (!m) continue;
    const n = Number(m[2]);
    const e = files.get(n) ?? {};
    const v = m[3]!.trim();
    const k = m[1]!.toLowerCase();
    if (k === 'file') e.file = v;
    else if (k === 'title') e.title = v || undefined;
    else {
      const d = Number(v);
      e.length = Number.isFinite(d) && d >= 0 ? d : undefined;
    }
    files.set(n, e);
  }
  return [...files.entries()].sort((a, b) => a[0] - b[0]).filter(([, e]) => e.file).map(([, e]) => ({
    raw: e.file!,
    ...resolveEntry(e.file!, baseDir, platform),
    ...(e.title ? { title: e.title } : {}),
    ...(e.length !== undefined ? { durationSec: e.length } : {}),
  }));
}

export function parsePlaylist(buf: Uint8Array, file: string, platform: Platform = process.platform): PlaylistEntry[] {
  const P = pathFor(platform);
  const text = decodePlaylist(buf);
  const base = P.dirname(file);
  const ext = P.extname(file).slice(1).toLowerCase();
  if (ext === 'pls' || /^\s*\[playlist\]/i.test(text)) return parsePls(text, base, platform);
  return parseM3u(text, base, platform);
}

/**
 * Write an extended M3U8 (UTF-8, LF line ends): `#EXTM3U`, then per entry
 * `#EXTINF:<whole seconds or -1>,<Artist - Title>` and the path — relative
 * (with "/") when the file is in the playlist's folder or below, else absolute.
 * Entries whose path contains a line break cannot be written and are counted.
 */
export function writeM3u8(entries: Array<{ path: string; title?: string; artist?: string; durationSec?: number }>, playlistDir: string, platform: Platform = process.platform): { text: string; written: number; skipped: number } {
  const P = pathFor(platform);
  const lines = ['#EXTM3U'];
  let written = 0;
  let skipped = 0;
  for (const e of entries) {
    if (/[\r\n]/.test(e.path)) {
      skipped++;
      continue;
    }
    const rel = P.relative(playlistDir, e.path);
    const inside = rel && rel !== '..' && !rel.startsWith(`..${P.sep}`) && !P.isAbsolute(rel);
    const where = inside ? rel.split(P.sep).join('/') : e.path;
    const name = [e.artist, e.title].map((x) => x?.replace(/[\r\n]+/g, ' ').trim()).filter(Boolean).join(' - ') || P.basename(e.path).replace(/\.[^.]+$/, '');
    const secs = e.durationSec !== undefined && Number.isFinite(e.durationSec) ? Math.round(e.durationSec) : -1;
    lines.push(`#EXTINF:${secs},${name}`, where);
    written++;
  }
  return { text: `${lines.join('\n')}\n`, written, skipped };
}
