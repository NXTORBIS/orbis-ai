import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import { EMPTY_PLAYER, extOf, FOLDER_ADD_LIMIT, isAudioPath, naturalCompare, OTHER_AUDIO, PLAYABLE_AUDIO, PlayerStateSchema, QUEUE_LIMIT, type PlayerState } from '../../shared/player';
import { requireAbsolute, validateName } from '../fs/paths';
import { exists } from '../fs/FileSystemService';
import { parsePlaylist, writeM3u8 } from './playlist';
import { readCoverArt } from './coverArt';

/**
 * The music player's main-process side: collecting audio files from folders
 * (natural order, links not followed, capped), opening and saving playlists,
 * checking which queued files still exist, cover art, and the stored queue.
 * Playback itself happens in the window through the read-only orbis-media://
 * protocol (mediaProtocol.ts), which these functions never widen.
 */

export const PLAYLIST_MAX_BYTES = 2 * 1024 * 1024;

/** Why a file cannot be played by the built-in player (undefined when it can be tried). */
export function unsupportedReason(p: string): string | undefined {
  const ext = extOf(p);
  if (PLAYABLE_AUDIO.has(ext)) return undefined;
  if (OTHER_AUDIO.has(ext)) return `${ext.toUpperCase()} files cannot be played by the built-in player. Convert them to FLAC or MP3 first (Convert…).`;
  return 'This is not an audio file the player can play.';
}

export interface CollectResult {
  files: string[];
  /** More audio files were found than `limit`; the rest were left out. */
  truncated: boolean;
  /** Symbolic links met and not followed. */
  links: number;
  /** Folders that could not be read. */
  unreadable: number;
}

/**
 * Audio files in the given files and folders: each folder's files in natural
 * name order, then its subfolders (also in natural order), recursively.
 * Hidden items inside folders and symbolic links are left out.
 */
export async function collectAudio(paths: string[], opts: { limit?: number; signal?: AbortSignal } = {}): Promise<CollectResult> {
  const limit = Math.min(opts.limit ?? FOLDER_ADD_LIMIT, QUEUE_LIMIT);
  const out: CollectResult = { files: [], truncated: false, links: 0, unreadable: 0 };
  let dirs = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (out.truncated || opts.signal?.aborted) return;
    if (depth > 32 || ++dirs > 50000) {
      out.truncated = true;
      return;
    }
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => undefined);
    if (!entries) {
      out.unreadable++;
      return;
    }
    const visible = entries.filter((e) => !e.name.startsWith('.')).sort((a, b) => naturalCompare(a.name, b.name));
    for (const e of visible) {
      if (e.isSymbolicLink()) {
        if (isAudioPath(e.name)) out.links++;
        continue;
      }
      if (e.isFile() && isAudioPath(e.name)) {
        if (out.files.length >= limit) {
          out.truncated = true;
          return;
        }
        out.files.push(path.join(dir, e.name));
      }
    }
    for (const e of visible) if (e.isDirectory() && !e.isSymbolicLink()) await walk(path.join(dir, e.name), depth + 1);
  };
  for (const raw of paths) {
    const p = requireAbsolute(raw, 'player.collect');
    const st = await fsp.lstat(p).catch(() => undefined);
    if (!st) continue;
    if (st.isSymbolicLink()) {
      // A link the user picked explicitly is followed once (to a file); folders behind links are not walked.
      const real = await fsp.stat(p).catch(() => undefined);
      if (real?.isFile() && isAudioPath(p) && out.files.length < limit) out.files.push(p);
      else out.links++;
      continue;
    }
    if (st.isFile()) {
      if (!isAudioPath(p)) continue;
      if (out.files.length >= limit) {
        out.truncated = true;
        break;
      }
      out.files.push(p);
    } else if (st.isDirectory()) await walk(p, 0);
    if (out.truncated) break;
  }
  return out;
}

export interface CheckedEntry {
  path: string;
  title?: string;
  durationSec?: number;
  missing?: boolean;
  error?: string;
}

/** Whether each file is there (a regular file, links followed) and playable. */
export async function checkFiles(paths: string[]): Promise<Array<{ path: string; missing: boolean; error?: string }>> {
  return Promise.all(paths.map(async (raw) => {
    let p: string;
    try {
      p = requireAbsolute(raw, 'player.check');
    } catch {
      return { path: raw, missing: true };
    }
    const st = await fsp.stat(p).catch(() => undefined);
    if (!st?.isFile()) return { path: raw, missing: true };
    const why = unsupportedReason(p);
    return why ? { path: raw, missing: false, error: why } : { path: raw, missing: false };
  }));
}

/** Read a playlist (.m3u, .m3u8, .pls): every entry in order, missing and unusable ones marked, none dropped. */
export async function openPlaylist(file: string): Promise<{ name: string; entries: CheckedEntry[]; truncated: boolean }> {
  const p = requireAbsolute(file, 'player.openPlaylist');
  const st = await fsp.stat(p).catch((err) => {
    throw new OrbisError(toOrbisError(err, 'player.openPlaylist', p, 'no'));
  });
  if (!st.isFile()) throw makeError('validation', 'player.openPlaylist', { target: p, message: 'This is not a playlist file.' });
  if (st.size > PLAYLIST_MAX_BYTES) throw makeError('unsupported', 'player.openPlaylist', { target: p, message: 'This playlist is larger than 2 MB and is not read.' });
  const parsed = parsePlaylist(await fsp.readFile(p), p);
  const entries: CheckedEntry[] = [];
  for (const e of parsed.slice(0, QUEUE_LIMIT)) {
    const base = { ...(e.title ? { title: e.title } : {}), ...(e.durationSec !== undefined ? { durationSec: e.durationSec } : {}) };
    if (!e.path) {
      entries.push({ path: e.raw, ...base, missing: true, error: e.problem });
      continue;
    }
    let where = e.path;
    let st2 = e.problem ? undefined : await fsp.stat(where).catch(() => undefined);
    if (!st2?.isFile() && e.alternative) {
      const alt = await fsp.stat(e.alternative).catch(() => undefined);
      if (alt?.isFile()) {
        where = e.alternative;
        st2 = alt;
      }
    }
    if (!st2?.isFile()) entries.push({ path: where, ...base, missing: true, ...(e.problem ? { error: e.problem } : {}) });
    else {
      const why = unsupportedReason(where);
      entries.push({ path: where, ...base, ...(why ? { error: why } : {}) });
    }
  }
  return { name: path.basename(p), entries, truncated: parsed.length > QUEUE_LIMIT };
}

/**
 * Save entries as an .m3u8 playlist in `dir`. A new file is committed with
 * link() (never replacing); replacing an existing playlist needs `replace`
 * (asked in the window) and swaps it atomically with rename().
 */
export async function savePlaylist(req: { dir: string; name: string; entries: Array<{ path: string; title?: string; artist?: string; durationSec?: number }>; replace?: boolean }): Promise<{ status: 'saved'; path: string; written: number; skipped: number } | { status: 'exists'; path: string }> {
  const dir = requireAbsolute(req.dir, 'player.savePlaylist');
  const dst = await fsp.stat(dir).catch(() => undefined);
  if (!dst?.isDirectory()) throw makeError('not_found', 'player.savePlaylist', { target: dir, message: 'The folder for the playlist does not exist.' });
  let name = req.name.trim();
  if (!/\.m3u8$/i.test(name)) name = `${name.replace(/\.(m3u|pls)$/i, '')}.m3u8`;
  const v = validateName(name);
  if (!v.valid) throw makeError('invalid_name', 'player.savePlaylist', { message: v.reason });
  const target = path.join(dir, name);
  const existing = await fsp.lstat(target).catch(() => undefined);
  if (existing && !req.replace) return { status: 'exists', path: target };
  if (existing && !existing.isFile()) throw makeError('already_exists', 'player.savePlaylist', { target, message: 'Something that is not a file has this name.' });
  const { text, written, skipped } = writeM3u8(req.entries, dir);
  const tmp = path.join(dir, `.orbis-part-${crypto.randomUUID()}.m3u8`);
  try {
    const fh = await fsp.open(tmp, 'wx', 0o666);
    try {
      await fh.writeFile(text, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    if ((await fsp.readFile(tmp, 'utf8')) !== text) throw makeError('io', 'player.savePlaylist', { message: 'The playlist could not be verified after writing.' });
    if (existing) await fsp.rename(tmp, target);
    else {
      try {
        await fsp.link(tmp, target);
        await fsp.unlink(tmp);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'EEXIST') return { status: 'exists', path: target };
        if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EOPNOTSUPP') throw err;
        if (await exists(target)) return { status: 'exists', path: target };
        await fsp.rename(tmp, target);
      }
    }
    return { status: 'saved', path: target, written, skipped };
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
  }
}

/** The embedded cover picture as a data: URL (≤ 8 MB, image types checked by their bytes), or null. */
export async function coverDataUrl(file: string): Promise<string | null> {
  const p = requireAbsolute(file, 'player.cover');
  const st = await fsp.stat(p).catch(() => undefined);
  if (!st?.isFile() || !isAudioPath(p)) return null;
  const art = await readCoverArt(p).catch(() => undefined);
  return art ? `data:${art.mime};base64,${art.data.toString('base64')}` : null;
}

/** Key-value storage the player state lives in (the profile's catalogue). */
export interface PlayerKv {
  getKv<T>(key: string, fallback: T): T;
  setKv(key: string, value: unknown): void;
}

export const PLAYER_KEY = 'player.v1';

export function loadPlayerState(kv: PlayerKv): PlayerState {
  const raw = kv.getKv<unknown>(PLAYER_KEY, null);
  if (!raw) return EMPTY_PLAYER;
  const parsed = PlayerStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_PLAYER;
}

export function savePlayerState(kv: PlayerKv, state: unknown): void {
  const parsed = PlayerStateSchema.safeParse(state);
  if (!parsed.success) throw makeError('validation', 'player.save', { message: 'The player state is not valid.' });
  kv.setKv(PLAYER_KEY, parsed.data);
}
