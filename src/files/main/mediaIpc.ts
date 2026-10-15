import type { IpcMainInvokeEvent } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../shared/ipc';
import { makeError, OrbisError, toOrbisError } from '../shared/errors';
import { requireAbsolute } from './fs/paths';
import { checkFiles, collectAudio, coverDataUrl, loadPlayerState, openPlaylist, savePlaylist, savePlayerState } from './media/player';
import { audioCopyTarget, compareForJoin, displaySize, LOSSLESS_ROTATE_EXTS, probeMedia, videoToolsCaps } from './media/videoTools';
import { detectFfmpeg } from './media/convert';
import type { Services } from './services';

/**
 * IPC handlers for the music player and the video tools. Payloads were
 * validated by the shared zod schemas (ipcHandlers.ts); paths are checked to
 * be absolute here and every file is stat'ed before it is read. Changes to
 * files run as 'video-tool' operations (ops:start), never from here; the only
 * file written here is a playlist the user saves (new file, or an atomic
 * replace the user confirmed).
 */

type Channels = 'player:load' | 'player:save' | 'player:collect' | 'player:check' | 'player:tags' | 'player:cover' | 'player:openPlaylist' | 'player:savePlaylist' | 'video:caps' | 'video:probe' | 'video:joinCheck';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

async function ffprobeOrFail(): Promise<string> {
  const caps = await videoToolsCaps();
  const info = await detectFfmpeg();
  if (!caps.available || !info.ffprobe) throw makeError('unavailable', 'video.probe', { message: caps.reason ?? 'FFmpeg is not available.' });
  return info.ffprobe;
}

async function requireFile(p: string, op: string): Promise<string> {
  const abs = requireAbsolute(p, op);
  const st = await fsp.stat(abs).catch((err) => {
    throw new OrbisError(toOrbisError(err, op, abs, 'no'));
  });
  if (!st.isFile()) throw makeError('validation', op, { target: abs, message: 'This is not a file.' });
  return abs;
}

export function mediaHandlers(s: Services): Handlers {
  return {
    'player:load': () => loadPlayerState(s.catalog),
    'player:save': (p) => savePlayerState(s.catalog, p.state),
    'player:collect': (p) => collectAudio(p.paths, { limit: p.limit }),
    'player:check': (p) => checkFiles(p.paths),
    'player:tags': async (p) => {
      const out: Record<string, { title?: string; artist?: string; album?: string; durationSec?: number }> = {};
      for (const raw of p.paths) {
        try {
          const m = await s.metadata.read(requireAbsolute(raw, 'player.tags'));
          if (m.kind === 'none') continue;
          out[raw] = { title: m.tags?.title, artist: m.tags?.artist ?? m.tags?.albumArtist, album: m.tags?.album, durationSec: m.durationSec };
        } catch {
          /* missing or unreadable: no tags */
        }
      }
      return out;
    },
    'player:cover': (p) => coverDataUrl(p.path),
    'player:openPlaylist': (p) => openPlaylist(p.path),
    'player:savePlaylist': async (p) => {
      const r = await savePlaylist(p);
      if (r.status === 'saved') {
        s.indexer.touch([r.path]);
        s.log.info('player.playlistSaved', { entries: r.written, skipped: r.skipped, replaced: !!p.replace });
      }
      return r;
    },
    'video:caps': () => videoToolsCaps(),
    'video:probe': async (p) => {
      const file = await requireFile(p.path, 'video.probe');
      const info = await probeMedia(await ffprobeOrFail(), file);
      const v = info.video;
      const size = v ? displaySize(v) : undefined;
      const ext = path.extname(file).slice(1).toLowerCase();
      return {
        path: file,
        durationSec: info.durationSec,
        hasVideo: !!v,
        hasAudio: !!info.audio,
        width: size?.width,
        height: size?.height,
        fps: v?.fps,
        videoCodec: v?.codec,
        audioCodec: info.audio?.codec,
        rotation: v?.rotation ?? 0,
        container: ext,
        audioCopy: info.audio ? audioCopyTarget(info.audio.codec) ?? null : null,
        losslessRotate: LOSSLESS_ROTATE_EXTS.has(ext),
      };
    },
    'video:joinCheck': async (p) => {
      const ffprobe = await ffprobeOrFail();
      const files: string[] = [];
      for (const x of p.paths) files.push(await requireFile(x, 'video.joinCheck'));
      const probes = [];
      for (const f of files) probes.push(await probeMedia(ffprobe, f));
      return compareForJoin(files, probes);
    },
  };
}
