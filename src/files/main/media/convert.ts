import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { makeError, toOrbisError } from '../../shared/errors';
import type { OperationRecord } from '../../shared/operations';
import type { ExternalRunner, RunnerHelpers } from '../ops/OperationManager';
import { exists } from '../fs/FileSystemService';
import { uniqueName, validateName } from '../fs/paths';
import { findExecutable } from '../launch/openWith';
import { readMetadata } from './metadata';

/**
 * Media conversion with real engines only:
 *  - Images: the platform image codec (Electron nativeImage) for PNG/JPEG
 *    input, or pixels already encoded by the app's own renderer (Chromium) for
 *    other formats and WebP output.
 *  - Audio/video: FFmpeg, when it is installed. Its presence and its encoders
 *    are detected; nothing is offered that the installed FFmpeg cannot do.
 * Originals are never modified. Output goes to a temporary file, is verified
 * by reading it back, and is committed without overwriting anything.
 */

export interface ImageEncoder {
  /** Decode `p`, optionally shrink so the longest side ≤ maxDimension, and encode. Undefined when the format cannot be decoded. */
  (p: string, opts: { format: 'png' | 'jpeg'; quality: number; maxDimension?: number }): Promise<Buffer | undefined>;
}

export const MEDIA_PRESETS = {
  mp4: { label: 'MP4 (H.264 + AAC)', ext: 'mp4', kind: 'video', encoders: ['libx264', 'aac'], args: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'] },
  webm: { label: 'WebM (VP9 + Opus)', ext: 'webm', kind: 'video', encoders: ['libvpx-vp9', 'libopus'], args: ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1', '-c:a', 'libopus', '-b:a', '128k'] },
  mp3: { label: 'MP3 audio', ext: 'mp3', kind: 'audio', encoders: ['libmp3lame'], args: ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'] },
  m4a: { label: 'M4A (AAC) audio', ext: 'm4a', kind: 'audio', encoders: ['aac'], args: ['-vn', '-c:a', 'aac', '-b:a', '192k'] },
  ogg: { label: 'Ogg Opus audio', ext: 'ogg', kind: 'audio', encoders: ['libopus'], args: ['-vn', '-c:a', 'libopus', '-b:a', '128k'] },
  flac: { label: 'FLAC (lossless) audio', ext: 'flac', kind: 'audio', encoders: ['flac'], args: ['-vn', '-c:a', 'flac'] },
  wav: { label: 'WAV (uncompressed) audio', ext: 'wav', kind: 'audio', encoders: ['pcm_s16le'], args: ['-vn', '-c:a', 'pcm_s16le'] },
} as const;
export type MediaPreset = keyof typeof MEDIA_PRESETS;

export interface FfmpegInfo {
  available: boolean;
  path?: string;
  version?: string;
  presets: Array<{ id: MediaPreset; label: string; kind: 'audio' | 'video' }>;
  note?: string;
  /** ffprobe next to FFmpeg (or on PATH); the video tools need it to read streams and to check results. */
  ffprobe?: string;
  /** Encoder names of the installed build (`ffmpeg -encoders`). */
  encoders?: string[];
  /** Filter names of the installed build (`ffmpeg -filters`), e.g. drawtext, tile, palettegen. */
  filters?: string[];
}

let ffmpegCache: FfmpegInfo | undefined;

export function resetFfmpegCache(): void {
  ffmpegCache = undefined;
}

export async function detectFfmpeg(): Promise<FfmpegInfo> {
  if (ffmpegCache) return ffmpegCache;
  const candidates = [findExecutable(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].filter((x): x is string => !!x);
  let bin: string | undefined;
  for (const c of candidates) if (await exists(c)) {
    bin = c;
    break;
  }
  if (!bin) return (ffmpegCache = { available: false, presets: [], note: 'FFmpeg is not installed. Install it to convert audio and video; image conversion does not need it.' });
  const run = (args: string[]) => new Promise<string>((resolve, reject) => execFile(bin!, args, { timeout: 10000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => (err ? reject(err) : resolve(out))));
  try {
    const version = (await run(['-hide_banner', '-version'])).split('\n')[0]?.trim();
    const enc = await run(['-hide_banner', '-encoders']);
    const have = new Set([...enc.matchAll(/^\s*[VAS][.\w]{5}\s+(\S+)/gm)].map((m) => m[1]!));
    const presets = (Object.keys(MEDIA_PRESETS) as MediaPreset[]).filter((id) => MEDIA_PRESETS[id].encoders.every((e) => have.has(e))).map((id) => ({ id, label: MEDIA_PRESETS[id].label, kind: MEDIA_PRESETS[id].kind }));
    // Filters and ffprobe are used by the video tools (media/videoTools.ts); a failure here only limits those.
    const filters = await run(['-hide_banner', '-filters']).then((out) => [...out.matchAll(/^\s*[TSC.|]{2,3}\s+(\w+)\s+\S+->\S+/gm)].map((m) => m[1]!), () => [] as string[]);
    const probeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    let ffprobe: string | undefined;
    for (const c of [path.join(path.dirname(bin), probeName), findExecutable(probeName)].filter((x): x is string => !!x)) if (await exists(c)) {
      ffprobe = c;
      break;
    }
    return (ffmpegCache = { available: true, path: bin, version, presets, ffprobe, encoders: [...have], filters });
  } catch (err) {
    return (ffmpegCache = { available: false, presets: [], note: `FFmpeg was found at ${bin} but did not run: ${(err as Error).message}` });
  }
}

const ParamsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), format: z.enum(['png', 'jpeg']), quality: z.number().int().min(1).max(100).default(88), maxDimension: z.number().int().min(16).max(30000).optional() }),
  z.object({ kind: z.literal('image-bytes'), format: z.enum(['png', 'jpeg', 'webp']), data: z.instanceof(Uint8Array), width: z.number().int().positive(), height: z.number().int().positive() }),
  z.object({ kind: z.literal('media'), preset: z.enum(Object.keys(MEDIA_PRESETS) as [MediaPreset, ...MediaPreset[]]) }),
]);

const EXT: Record<string, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' };

async function commitNew(tmp: string, target: string, helpers: RunnerHelpers): Promise<string> {
  let final = target;
  const dir = path.dirname(target);
  if (await exists(final)) {
    const action = await helpers.ask({ source: path.basename(target), destination: target, sourceKind: 'file', destinationKind: 'file', suggestedName: await uniqueName(dir, path.basename(target), exists), remaining: 0 });
    if (action === 'skip' || action === 'merge') return '';
    if (action === 'keep-both') final = path.join(dir, await uniqueName(dir, path.basename(target), exists));
    if (action === 'replace') {
      await fsp.rename(tmp, final);
      helpers.committed(tmp);
      return final;
    }
  }
  await fsp.link(tmp, final);
  await fsp.unlink(tmp);
  helpers.committed(tmp);
  return final;
}

function runFfmpeg(bin: string, args: string[], durationSec: number | undefined, signal: AbortSignal, onFraction: (f: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    let buf = '';
    const abort = () => child.kill('SIGKILL');
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (c: Buffer) => {
      buf += c.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m && durationSec) onFraction(Math.min(1, Number(m[1]) / 1e6 / durationSec));
      }
    });
    child.stderr.on('data', (c: Buffer) => {
      err = (err + c.toString()).slice(-4000);
    });
    child.on('error', (e) => reject(makeError('io', 'convert.media', { message: `FFmpeg could not be started: ${e.message}` })));
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) return reject(makeError('cancelled', 'convert.media'));
      if (code === 0) resolve();
      else reject(makeError('io', 'convert.media', { message: `FFmpeg could not convert this file: ${err.split('\n').filter((l) => l.trim()).slice(-2).join(' ') || `exit code ${code}`}` }));
    });
  });
}

export function makeConvertRunner(deps: { encodeImage?: ImageEncoder; markRunning: (rec: OperationRecord) => void }): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const parsed = ParamsSchema.safeParse(req.params);
    if (!parsed.success) throw makeError('validation', 'convert', { message: 'The conversion settings are not valid.' });
    const params = parsed.data;
    const dest = rec.destination!;
    rec.progress = { totalItems: rec.sources.length, completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    const ffmpeg = params.kind === 'media' ? await detectFfmpeg() : undefined;
    if (params.kind === 'media' && (!ffmpeg?.available || !ffmpeg.presets.some((p) => p.id === params.preset))) throw makeError('unavailable', 'convert.media', { message: ffmpeg?.note ?? 'The installed FFmpeg cannot produce this format.' });
    if (params.kind === 'image-bytes' && rec.sources.length !== 1) throw makeError('validation', 'convert', { message: 'Encoded image data belongs to one source file.' });
    for (const [i, src] of rec.sources.entries()) {
      await ctx.gate();
      const stem = path.basename(src).replace(/\.[^.]+$/, '') || 'converted';
      const ext = params.kind === 'media' ? MEDIA_PRESETS[params.preset].ext : EXT[params.format]!;
      const name = `${stem}.${ext}`;
      const v = validateName(name);
      const tmp = path.join(dest, `.orbis-part-${crypto.randomUUID()}.${ext}`);
      try {
        if (!v.valid) throw makeError('invalid_name', 'convert', { message: v.reason });
        helpers.temp(tmp);
        if (params.kind === 'image') {
          if (!deps.encodeImage) throw makeError('unavailable', 'convert.image', { message: 'Image conversion is not available here.' });
          const out = await deps.encodeImage(src, { format: params.format, quality: params.quality, maxDimension: params.maxDimension });
          if (!out) throw makeError('unsupported', 'convert.image', { target: src, message: 'This image format cannot be decoded by the built-in converter.' });
          await fsp.writeFile(tmp, out, { flag: 'wx' });
        } else if (params.kind === 'image-bytes') {
          await fsp.writeFile(tmp, params.data, { flag: 'wx' });
        } else {
          const srcMeta = await readMetadata(src);
          if (MEDIA_PRESETS[params.preset].kind === 'video' && srcMeta.kind !== 'video') throw makeError('validation', 'convert.media', { target: src, message: 'This file has no video to convert; choose an audio format.' });
          await runFfmpeg(ffmpeg!.path!, ['-hide_banner', '-nostdin', '-nostats', '-progress', 'pipe:1', '-y', '-i', src, ...MEDIA_PRESETS[params.preset].args, tmp], srcMeta.durationSec, ctx.signal, (f) => {
            rec.progress.fraction = (i + f) / rec.sources.length;
            helpers.tick(0, 0, path.basename(src));
          });
          const out = await readMetadata(tmp);
          const wantKind = MEDIA_PRESETS[params.preset].kind;
          if (out.kind !== wantKind || !(out.durationSec && out.durationSec > 0)) throw makeError('io', 'convert.media', { message: 'The converted file did not verify as playable media; nothing was saved.' });
          if (srcMeta.durationSec && Math.abs(out.durationSec - srcMeta.durationSec) > Math.max(1.5, srcMeta.durationSec * 0.05)) throw makeError('io', 'convert.media', { message: 'The converted file is shorter than the original; nothing was saved.' });
        }
        if (params.kind !== 'media') {
          const out = await readMetadata(tmp);
          if (out.kind !== 'image' || !out.width || !out.height) throw makeError('io', 'convert.image', { message: 'The converted image did not verify; nothing was saved.' });
          if (params.kind === 'image-bytes' && (out.width !== params.width || out.height !== params.height)) throw makeError('io', 'convert.image', { message: 'The converted image has unexpected dimensions; nothing was saved.' });
        }
        const final = await commitNew(tmp, path.join(dest, name), helpers);
        rec.results.push(final ? { source: src, destination: final, status: 'done' } : { source: src, status: 'skipped' });
      } catch (err) {
        await fsp.rm(tmp, { force: true }).catch(() => undefined);
        helpers.committed(tmp);
        const shape = toOrbisError(err, 'convert', src, 'no');
        if (shape.category === 'cancelled') throw err;
        rec.results.push({ source: src, status: 'failed', error: shape });
      }
      helpers.tick(0, 1, path.basename(src));
    }
  };
}
