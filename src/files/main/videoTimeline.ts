import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../shared/ipc';
import { makeError, OrbisError, toOrbisError } from '../shared/errors';
import { requireAbsolute } from './fs/paths';
import type { VideoTimelineResult, VideoTimelineThumbnail } from '../shared/videoTimeline';

const exec = promisify(execFile);

type Channels = 'videoTimeline:extract';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

async function findFfmpeg(): Promise<string> {
  for (const name of ['ffmpeg']) {
    try {
      await exec('which', [name]);
      return name;
    } catch { /* not found */ }
  }
  throw makeError('unavailable', 'videoTimeline', { message: 'FFmpeg is required but not found on this system.' });
}

async function findFfprobe(): Promise<string> {
  for (const name of ['ffprobe']) {
    try {
      await exec('which', [name]);
      return name;
    } catch { /* not found */ }
  }
  throw makeError('unavailable', 'videoTimeline', { message: 'ffprobe is required but not found on this system.' });
}

interface ProbeInfo {
  durationSec: number;
  codec: string;
  width: number;
  height: number;
  fps: number;
}

async function probeVideo(ffprobe: string, filePath: string): Promise<ProbeInfo> {
  const { stdout } = await exec(ffprobe, [
    '-v', 'quiet', '-print_format', 'json',
    '-show_format', '-show_streams',
    filePath,
  ], { timeout: 30000 });

  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string; duration?: string }>;
  };

  const videoStream = data.streams?.find((s) => s.codec_type === 'video');
  const durationSec = parseFloat(data.format?.duration ?? videoStream?.duration ?? '0');
  const codec = videoStream?.codec_name ?? 'unknown';
  const width = videoStream?.width ?? 0;
  const height = videoStream?.height ?? 0;
  let fps = 0;
  if (videoStream?.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/');
    fps = den ? parseFloat(num!) / parseFloat(den) : parseFloat(num!);
  }

  return { durationSec, codec, width, height, fps: Math.round(fps * 100) / 100 };
}

export function videoTimelineHandlers(): Handlers {
  return {
    'videoTimeline:extract': async (p) => {
      const abs = requireAbsolute(p.path, 'videoTimeline.extract');
      const stat = await fsp.stat(abs).catch((err) => {
        throw new OrbisError(toOrbisError(err, 'videoTimeline.extract', abs, 'no'));
      });
      if (!stat.isFile()) throw makeError('validation', 'videoTimeline.extract', { target: abs, message: 'Not a file.' });

      const ffmpeg = await findFfmpeg();
      const ffprobe = await findFfprobe();
      const info = await probeVideo(ffprobe, abs);

      if (info.durationSec <= 0) throw makeError('validation', 'videoTimeline.extract', { target: abs, message: 'Could not determine video duration.' });

      const count = Math.min(p.count, Math.max(2, Math.floor(info.durationSec)));
      const interval = info.durationSec / count;
      const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'orbis-vtl-'));

      try {
        const thumbnails: VideoTimelineThumbnail[] = [];
        for (let i = 0; i < count; i++) {
          const timeSec = Math.min(interval * i + interval / 2, info.durationSec - 0.1);
          const outFile = path.join(tmpDir, `thumb_${i}.jpg`);
          try {
            await exec(ffmpeg, [
              '-ss', String(timeSec),
              '-i', abs,
              '-vframes', '1',
              '-vf', `scale=-1:${p.thumbHeight}`,
              '-q:v', '4',
              '-y', outFile,
            ], { timeout: 15000 });

            const jpegBuf = await fsp.readFile(outFile);
            // Get dimensions from the output
            const { stdout: probeOut } = await exec(ffprobe, [
              '-v', 'quiet', '-print_format', 'json', '-show_streams', outFile,
            ], { timeout: 5000 }).catch(() => ({ stdout: '{}' }));
            const thumbData = JSON.parse(probeOut) as { streams?: Array<{ width?: number; height?: number }> };
            const ts = thumbData.streams?.[0];

            thumbnails.push({
              timeSec: Math.round(timeSec * 100) / 100,
              jpegBase64: jpegBuf.toString('base64'),
              width: ts?.width ?? Math.round(p.thumbHeight * (info.width / Math.max(1, info.height))),
              height: ts?.height ?? p.thumbHeight,
            });
          } catch {
            // Skip frames that fail to extract
          }
        }

        const result: VideoTimelineResult = {
          thumbnails,
          durationSec: info.durationSec,
          codec: info.codec,
          resolution: { width: info.width, height: info.height },
          fps: info.fps,
          fileSize: stat.size,
        };
        return result;
      } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}
