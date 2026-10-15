import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { makeError, toOrbisError } from '../../shared/errors';
import type { OperationRecord, OperationRequest } from '../../shared/operations';
import { fileTimecode, JOIN_MAX, sheetGeometry, SINGLE_SOURCE_TOOLS, VideoToolSpecSchema, type VideoToolSpec } from '../../shared/videoTools';
export { sheetGeometry };
import type { ExternalRunner, RunContext, RunnerHelpers } from '../ops/OperationManager';
import { exists } from '../fs/FileSystemService';
import { uniqueName, validateName } from '../fs/paths';
import { detectFfmpeg, type FfmpegInfo } from './convert';
import { ffPath, PAUSE_SUPPORTED, PAUSE_UNAVAILABLE_REASON, runFfmpeg, runQuiet } from './ffmpegRun';

/**
 * Video tools with the installed FFmpeg, run as 'video-tool' operations:
 * trim (stream copy or exact re-encode), extract audio (copy when the codec
 * fits a container, else encode), GIF (two-pass palette) or animated WebP,
 * contact sheet (tile filter, optional drawtext time stamps), save a frame
 * as PNG, join (concat demuxer when streams match, else re-encode) and
 * rotate/flip (display matrix without re-encoding where the container
 * supports it, else re-encode).
 *
 * Every output is written to an `.orbis-part-*` file in the destination,
 * checked with ffprobe, then committed under a free name with link() — an
 * existing file is never replaced. Cancel kills FFmpeg's process tree and the
 * partial file is removed; Undo moves the new files to the Trash.
 */

const PART = '.orbis-part-';

/* ------------------------------------------------------------------ probing */

export interface ProbeStream {
  index: number;
  type: 'video' | 'audio' | 'subtitle' | 'data' | 'attachment' | string;
  codec?: string;
  width?: number;
  height?: number;
  pixFmt?: string;
  fps?: number;
  sampleRate?: number;
  channels?: number;
  /** Counter-clockwise display rotation in degrees from the display matrix ((-180, 180]). */
  rotation?: number;
  /** The display matrix mirrors the picture. */
  mirrored?: boolean;
  /** Cover art / attached picture (not a real video track). */
  attachedPic?: boolean;
  frames?: number;
  durationSec?: number;
}

export interface ProbeResult {
  durationSec?: number;
  formatName: string;
  streams: ProbeStream[];
  /** The first real video stream (attached pictures are not video). */
  video?: ProbeStream;
  audio?: ProbeStream;
}

const rate = (v: unknown): number | undefined => {
  if (typeof v !== 'string') return undefined;
  const [a, b] = v.split('/').map(Number);
  if (!a || !Number.isFinite(a)) return undefined;
  const r = b ? a / b : a;
  return Number.isFinite(r) && r > 0 && r < 1000 ? r : undefined;
};

function parseDisplayMatrix(s: string | undefined): number[] | undefined {
  if (!s) return undefined;
  const nums = [...s.matchAll(/:\s*(-?\d+)\s+(-?\d+)\s+(-?\d+)/g)].flatMap((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  return nums.length === 9 ? nums : undefined;
}

export async function probeMedia(ffprobe: string, file: string, opts: { countFrames?: boolean } = {}): Promise<ProbeResult> {
  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', ...(opts.countFrames ? ['-count_frames'] : []), ffPath(file)];
  let raw: string;
  try {
    raw = await runQuiet(ffprobe, args, opts.countFrames ? 120000 : 30000);
  } catch (err) {
    throw makeError('unsupported', 'video.probe', { target: file, message: `FFmpeg cannot read this file: ${(err as Error).message || 'unknown format'}` });
  }
  const j = JSON.parse(raw) as { format?: Record<string, unknown>; streams?: Array<Record<string, unknown>> };
  const streams: ProbeStream[] = (j.streams ?? []).map((s) => {
    const side = Array.isArray(s.side_data_list) ? (s.side_data_list as Array<Record<string, unknown>>) : [];
    const dm = side.find((d) => d.side_data_type === 'Display Matrix');
    const matrix = parseDisplayMatrix(typeof dm?.displaymatrix === 'string' ? dm.displaymatrix : undefined);
    const disp = (s.disposition ?? {}) as Record<string, number>;
    const num = (v: unknown) => (v === undefined || v === 'N/A' ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined);
    // Older builds report the rotation as a stream tag instead of side data.
    const tagRotate = num((s.tags as Record<string, unknown> | undefined)?.rotate);
    return {
      index: Number(s.index),
      type: String(s.codec_type ?? ''),
      codec: typeof s.codec_name === 'string' ? s.codec_name : undefined,
      width: num(s.width),
      height: num(s.height),
      pixFmt: typeof s.pix_fmt === 'string' ? s.pix_fmt : undefined,
      fps: rate(s.avg_frame_rate) ?? rate(s.r_frame_rate),
      sampleRate: num(s.sample_rate),
      channels: num(s.channels),
      rotation: typeof dm?.rotation === 'number' ? dm.rotation : tagRotate !== undefined ? -tagRotate : undefined,
      mirrored: matrix ? matrix[0]! * matrix[4]! - matrix[1]! * matrix[3]! < 0 : undefined,
      attachedPic: disp.attached_pic === 1,
      frames: num(s.nb_read_frames) ?? num(s.nb_frames),
      durationSec: num(s.duration),
    };
  });
  const formatDuration = Number(j.format?.duration);
  return {
    durationSec: Number.isFinite(formatDuration) && formatDuration > 0 ? formatDuration : streams.find((x) => x.durationSec)?.durationSec,
    formatName: String(j.format?.format_name ?? ''),
    streams,
    video: streams.find((x) => x.type === 'video' && !x.attachedPic),
    audio: streams.find((x) => x.type === 'audio'),
  };
}

/** Width and height as shown (a 90° display rotation swaps them). */
export function displaySize(v: ProbeStream): { width: number; height: number } | undefined {
  if (!v.width || !v.height) return undefined;
  const r = Math.abs(Math.round(v.rotation ?? 0)) % 180;
  return r === 90 ? { width: v.height, height: v.width } : { width: v.width, height: v.height };
}

/* ------------------------------------------------------------------ capabilities */

export interface VideoToolsCaps {
  available: boolean;
  /** Why the tools are off (FFmpeg or ffprobe missing). */
  reason?: string;
  version?: string;
  /** Animated WebP needs the libwebp_anim encoder. */
  webp: boolean;
  /** Time stamps on contact sheets need the drawtext filter. */
  drawtext: boolean;
  /** Encoders used when re-encoding: H.264 + AAC (trim exact, join, rotate). */
  h264: boolean;
  encoders: { m4a: boolean; mp3: boolean; opus: boolean; flac: boolean; wav: boolean; vp9: boolean };
  pause: boolean;
  pauseReason?: string;
}

export function toolsCaps(info: FfmpegInfo): VideoToolsCaps {
  const enc = new Set(info.encoders ?? []);
  const filters = new Set(info.filters ?? []);
  const base = {
    version: info.version,
    webp: enc.has('libwebp_anim'),
    drawtext: filters.has('drawtext'),
    h264: enc.has('libx264') && enc.has('aac'),
    encoders: { m4a: enc.has('aac'), mp3: enc.has('libmp3lame'), opus: enc.has('libopus'), flac: enc.has('flac'), wav: enc.has('pcm_s16le'), vp9: enc.has('libvpx-vp9') },
    pause: PAUSE_SUPPORTED,
    pauseReason: PAUSE_SUPPORTED ? undefined : PAUSE_UNAVAILABLE_REASON,
  };
  if (!info.available) return { ...base, available: false, reason: info.note ?? 'FFmpeg is not installed. Install FFmpeg to use the video tools.' };
  if (!info.ffprobe) return { ...base, available: false, reason: `FFmpeg was found (${info.path}) but ffprobe, which comes with it, was not. The video tools need both.` };
  for (const f of ['tile', 'palettegen', 'paletteuse', 'scale', 'fps']) if (info.filters && info.filters.length && !filters.has(f)) return { ...base, available: false, reason: `The installed FFmpeg has no “${f}” filter, which the video tools need.` };
  return { ...base, available: true };
}

export async function videoToolsCaps(): Promise<VideoToolsCaps> {
  return toolsCaps(await detectFfmpeg());
}

/* ------------------------------------------------------------------ containers and codecs */

const COPY_AUDIO: Record<string, { ext: string; label: string }> = {
  aac: { ext: 'm4a', label: 'AAC' }, alac: { ext: 'm4a', label: 'ALAC' }, mp3: { ext: 'mp3', label: 'MP3' }, opus: { ext: 'opus', label: 'Opus' },
  vorbis: { ext: 'ogg', label: 'Vorbis' }, flac: { ext: 'flac', label: 'FLAC' }, ac3: { ext: 'ac3', label: 'AC-3' }, eac3: { ext: 'eac3', label: 'E-AC-3' },
};

/** Where the audio stream can be copied without re-encoding (WAV for PCM, Matroska audio for anything else). */
export function audioCopyTarget(codec: string | undefined): { ext: string; label: string } | undefined {
  if (!codec) return undefined;
  if (COPY_AUDIO[codec]) return COPY_AUDIO[codec];
  if (/^pcm_(s16le|s24le|s32le|f32le|u8)$/.test(codec)) return { ext: 'wav', label: 'PCM' };
  return { ext: 'mka', label: codec.toUpperCase() };
}

const ENCODE_AUDIO: Record<'m4a' | 'mp3' | 'opus' | 'flac' | 'wav', { ext: string; args: string[]; encoder: string }> = {
  m4a: { ext: 'm4a', encoder: 'aac', args: ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'] },
  mp3: { ext: 'mp3', encoder: 'libmp3lame', args: ['-c:a', 'libmp3lame', '-q:a', '2'] },
  opus: { ext: 'opus', encoder: 'libopus', args: ['-c:a', 'libopus', '-b:a', '128k'] },
  flac: { ext: 'flac', encoder: 'flac', args: ['-c:a', 'flac'] },
  wav: { ext: 'wav', encoder: 'pcm_s16le', args: ['-c:a', 'pcm_s16le'] },
};

/** Containers whose display matrix FFmpeg writes, so rotation and flips can change without re-encoding. */
export const LOSSLESS_ROTATE_EXTS = new Set(['mp4', 'm4v', 'mov']);
const VIDEO_EXTS = new Set(['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'ogv', 'wmv', 'flv', 'ts', 'mts', 'm2ts', '3gp', 'mpg', 'mpeg']);
const AUDIO_EXTS = new Set(['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'wma', 'aif', 'aiff', 'mka']);

const extOf = (p: string) => path.extname(p).slice(1).toLowerCase();
const stemOf = (p: string) => path.basename(p).replace(/\.[^.]+$/, '') || 'video';

/** Re-encoding settings for the trim's exact mode, by source container. */
function exactEncode(src: string, hasVideo: boolean): { ext: string; args: string[]; encoders: string[] } {
  const ext = extOf(src);
  if (!hasVideo) {
    const a = ext === 'mp3' ? ENCODE_AUDIO.mp3 : ext === 'flac' ? ENCODE_AUDIO.flac : ext === 'wav' ? ENCODE_AUDIO.wav : ext === 'opus' || ext === 'ogg' || ext === 'oga' ? ENCODE_AUDIO.opus : ENCODE_AUDIO.m4a;
    return { ext: a.ext, args: ['-vn', ...a.args], encoders: [a.encoder] };
  }
  if (ext === 'webm') return { ext: 'webm', args: ['-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-row-mt', '1', '-c:a', 'libopus', '-b:a', '128k'], encoders: ['libvpx-vp9', 'libopus'] };
  return { ext: ext === 'mov' ? 'mov' : ext === 'mkv' ? 'mkv' : 'mp4', args: H264_ARGS, encoders: ['libx264', 'aac'] };
}

const H264_ARGS = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'];

/* ------------------------------------------------------------------ join check */

export interface JoinCheck {
  /** Every stream matches: the concat demuxer can join without re-encoding. */
  match: boolean;
  reasons: string[];
  totalSec: number;
  items: Array<{ path: string; durationSec?: number; summary: string; hasVideo: boolean; hasAudio: boolean }>;
}

function streamSummary(p: ProbeResult): string {
  const v = p.video;
  const a = p.audio;
  return [v ? `${v.codec ?? '?'} ${v.width}×${v.height}${v.fps ? ` ${Math.round(v.fps * 100) / 100} fps` : ''}` : 'no video', a ? `${a.codec ?? '?'} ${a.sampleRate ? `${a.sampleRate / 1000} kHz` : ''}${a.channels ? ` ${a.channels} ch` : ''}`.trim() : 'no audio'].join(' · ');
}

export function compareForJoin(files: string[], probes: ProbeResult[]): JoinCheck {
  const reasons: string[] = [];
  const first = probes[0]!;
  const name = (i: number) => path.basename(files[i]!);
  probes.forEach((p, i) => {
    if (i === 0) return;
    const v0 = first.video;
    const v = p.video;
    const a0 = first.audio;
    const a = p.audio;
    if (!!v0 !== !!v) reasons.push(`${name(i)} ${v ? 'has' : 'has no'} video, unlike ${name(0)}.`);
    else if (v0 && v) {
      if (v0.codec !== v.codec) reasons.push(`${name(i)} uses ${v.codec} video, ${name(0)} uses ${v0.codec}.`);
      else if (v0.width !== v.width || v0.height !== v.height) reasons.push(`${name(i)} is ${v.width}×${v.height}, ${name(0)} is ${v0.width}×${v0.height}.`);
      else if (v0.pixFmt !== v.pixFmt) reasons.push(`${name(i)} stores colour as ${v.pixFmt}, ${name(0)} as ${v0.pixFmt}.`);
      else if (v0.fps && v.fps && Math.abs(v0.fps - v.fps) > 0.01) reasons.push(`${name(i)} has ${Math.round(v.fps * 100) / 100} fps, ${name(0)} has ${Math.round(v0.fps * 100) / 100}.`);
      else if ((v0.rotation ?? 0) !== (v.rotation ?? 0)) reasons.push(`${name(i)} is rotated differently from ${name(0)}.`);
    }
    if (!!a0 !== !!a) reasons.push(`${name(i)} ${a ? 'has' : 'has no'} sound, unlike ${name(0)}.`);
    else if (a0 && a) {
      if (a0.codec !== a.codec) reasons.push(`${name(i)} uses ${a.codec} audio, ${name(0)} uses ${a0.codec}.`);
      else if (a0.sampleRate !== a.sampleRate || a0.channels !== a.channels) reasons.push(`${name(i)}'s audio is ${a.sampleRate} Hz / ${a.channels} ch, ${name(0)}'s is ${a0.sampleRate} Hz / ${a0.channels} ch.`);
    }
  });
  return {
    match: reasons.length === 0,
    reasons,
    totalSec: probes.reduce((t, p) => t + (p.durationSec ?? 0), 0),
    items: probes.map((p, i) => ({ path: files[i]!, durationSec: p.durationSec, summary: streamSummary(p), hasVideo: !!p.video, hasAudio: !!p.audio })),
  };
}

/* ------------------------------------------------------------------ helpers */

/** Commit a finished temporary file under `name` in `dir`, or a free "name (2)" — never replacing anything. */
export async function commitUnique(tmp: string, dir: string, name: string, helpers: Pick<RunnerHelpers, 'committed'>): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const target = path.join(dir, (await exists(path.join(dir, name))) ? await uniqueName(dir, name, exists) : name);
    try {
      await fsp.link(tmp, target);
      await fsp.unlink(tmp);
      helpers.committed(tmp);
      return target;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'EEXIST') continue;
      if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EOPNOTSUPP' || code === 'EXDEV') {
        if (await exists(target)) continue;
        await fsp.rename(tmp, target);
        helpers.committed(tmp);
        return target;
      }
      throw err;
    }
  }
  throw makeError('already_exists', 'video.commit', { message: 'Could not find a free name for the new file.' });
}

/** Animated WebP check without a decoder: RIFF/WEBP with VP8X canvas size and the number of ANMF frames. */
export async function inspectWebp(p: string): Promise<{ width: number; height: number; frames: number } | undefined> {
  const b = await fsp.readFile(p);
  if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP' || b.toString('latin1', 12, 16) !== 'VP8X') return undefined;
  const width = b.readUIntLE(24, 3) + 1;
  const height = b.readUIntLE(27, 3) + 1;
  let frames = 0;
  let o = 12;
  while (o + 8 <= b.length) {
    const id = b.toString('latin1', o, o + 4);
    const len = b.readUInt32LE(o + 4);
    if (id === 'ANMF') frames++;
    o += 8 + len + (len % 2);
  }
  return { width, height, frames };
}

/** Normalize degrees to (-180, 180]. */
export function normDeg(d: number): number {
  let x = ((Math.round(d) % 360) + 360) % 360;
  if (x > 180) x -= 360;
  return x;
}

/** Escape a path for a line of an FFmpeg concat list (single-quoted; ' becomes '\''). */
export function concatListLine(p: string): string {
  if (/[\r\n]/.test(p)) throw makeError('invalid_name', 'video.join', { target: p, message: 'A file name with a line break cannot be joined.' });
  return `file '${ffPath(p).replace(/'/g, "'\\''")}'`;
}

/* ------------------------------------------------------------------ the runner */

export function validateVideoToolRequest(req: OperationRequest): void {
  const parsed = VideoToolSpecSchema.safeParse((req.params ?? {}).spec);
  if (!parsed.success) throw makeError('validation', 'video.tool', { message: parsed.error.issues[0]?.message ?? 'The video tool settings are not valid.' });
  const spec = parsed.data;
  if (!req.destination) throw makeError('validation', 'video.tool', { message: 'A folder for the new files is required.' });
  if (!req.sources.length) throw makeError('validation', 'video.tool', { message: 'Choose a video first.' });
  if (SINGLE_SOURCE_TOOLS.has(spec.tool) && req.sources.length !== 1) throw makeError('validation', 'video.tool', { message: 'This tool works on one file at a time.' });
  if (spec.tool === 'join' && (req.sources.length < 2 || req.sources.length > JOIN_MAX)) throw makeError('validation', 'video.tool', { message: `Join needs 2 to ${JOIN_MAX} files.` });
  if (req.sources.length > 500) throw makeError('validation', 'video.tool', { message: 'Choose at most 500 files.' });
}

interface Job {
  rec: OperationRecord;
  ctx: RunContext;
  helpers: RunnerHelpers;
  ffmpeg: string;
  ffprobe: string;
  caps: VideoToolsCaps;
  dest: string;
  /** Index of the item being worked on and how many there are (for the overall fraction). */
  index: number;
  count: number;
  notes: Set<string>;
  /** Encoder names of the installed build. */
  encoders: Set<string>;
}

function reportProgress(job: Job, part: { from: number; to: number }) {
  return (p: { fraction?: number; etaSec?: number }) => {
    const f = p.fraction === undefined ? undefined : part.from + (part.to - part.from) * p.fraction;
    if (f !== undefined) job.rec.progress.fraction = (job.index + f) / job.count;
    // Time left for this item's current step; later steps or items add to it, so it is a lower bound.
    job.rec.progress.etaSec = p.etaSec;
    job.helpers.tick(0, 0, job.rec.progress.currentItem);
  };
}

async function tempFile(job: Job, ext: string): Promise<string> {
  const tmp = path.join(job.dest, `${PART}${crypto.randomUUID()}.${ext}`);
  job.helpers.temp(tmp);
  return tmp;
}

async function ff(job: Job, args: string[], totalSec: number | undefined, what: string, part = { from: 0, to: 1 }): Promise<void> {
  await job.ctx.gate();
  await runFfmpeg({ bin: job.ffmpeg, args, totalSec, ctx: job.ctx, onProgress: reportProgress(job, part), what, op: 'video.tool' });
}

const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

function requireEncoders(job: Job, encoders: string[]): void {
  const missing = encoders.filter((e) => !job.encoders.has(e));
  if (missing.length) throw makeError('unavailable', 'video.tool', { message: `The installed FFmpeg has no ${missing.join(' / ')} encoder needed here.` });
}

/** One tool on one source: returns the temporary output and the name to commit it under. */
async function runOne(job: Job, spec: Exclude<VideoToolSpec, { tool: 'join' }>, src: string): Promise<{ tmp: string; name: string }> {
  const info = await probeMedia(job.ffprobe, src);
  const stem = stemOf(src);
  const srcExt = extOf(src);
  const v = info.video;
  const dur = info.durationSec;
  switch (spec.tool) {
    case 'trim': {
      if (!v && !info.audio) throw makeError('unsupported', 'video.trim', { target: src, message: 'This file has no video or audio to trim.' });
      const end = dur ? Math.min(spec.end, dur) : spec.end;
      const len = end - spec.start;
      if (len <= 0) throw makeError('validation', 'video.trim', { target: src, message: 'The start is after the end of the file.' });
      let ext = srcExt;
      let codecArgs: string[];
      if (spec.mode === 'fast') {
        if (!VIDEO_EXTS.has(ext) && !AUDIO_EXTS.has(ext)) ext = v ? 'mkv' : 'mka';
        codecArgs = ['-c', 'copy', '-avoid_negative_ts', 'make_zero'];
      } else {
        const e = exactEncode(src, !!v);
        requireEncoders(job, e.encoders);
        ext = e.ext;
        codecArgs = e.args;
      }
      const tmp = await tempFile(job, ext);
      const maps = v ? ['-map', `0:${v.index}`, '-map', '0:a?'] : ['-map', '0:a'];
      await ff(job, ['-ss', spec.start.toFixed(6), '-i', ffPath(src), '-t', len.toFixed(6), ...maps, ...codecArgs, '-y', ffPath(tmp)], len, 'trim this file');
      const out = await probeMedia(job.ffprobe, tmp);
      const got = out.durationSec ?? 0;
      // Exact cuts land within a frame or two (audio priming adds a few ms); stream copy starts at the keyframe before the start.
      const ok = spec.mode === 'exact' ? close(got, len, Math.max(0.3, v?.fps ? 3 / v.fps : 0)) : got > 0 && got <= len + 30;
      if (!ok) throw makeError('io', 'video.trim', { target: src, message: `The trimmed file is ${got.toFixed(2)} s long instead of about ${len.toFixed(2)} s; nothing was saved.` });
      if (spec.mode === 'fast' && got > len + 0.5) job.notes.add(`Fast mode starts on the keyframe before the start mark, so the result is ${(got - len).toFixed(1)} s longer than marked. Use Exact for a frame-accurate cut.`);
      return { tmp, name: `${stem} (trimmed).${ext}` };
    }
    case 'extractAudio': {
      const a = info.audio;
      if (!a) throw makeError('unsupported', 'video.extractAudio', { target: src, message: 'This file has no audio track.' });
      let ext: string;
      let codecArgs: string[];
      if (spec.format === 'copy') {
        const t = audioCopyTarget(a.codec)!;
        ext = t.ext;
        codecArgs = ['-c:a', 'copy', ...(ext === 'm4a' ? ['-movflags', '+faststart'] : [])];
      } else {
        const e = ENCODE_AUDIO[spec.format];
        requireEncoders(job, [e.encoder]);
        ext = e.ext;
        codecArgs = e.args;
      }
      const tmp = await tempFile(job, ext);
      await ff(job, ['-i', ffPath(src), '-map', `0:${a.index}`, '-vn', '-sn', '-dn', ...codecArgs, '-y', ffPath(tmp)], dur, 'extract the audio');
      const out = await probeMedia(job.ffprobe, tmp);
      if (!out.audio || out.video || !(out.durationSec && out.durationSec > 0)) throw makeError('io', 'video.extractAudio', { target: src, message: 'The extracted file did not verify as audio; nothing was saved.' });
      return { tmp, name: `${stem}.${ext}` };
    }
    case 'gif': {
      if (!v) throw makeError('unsupported', 'video.gif', { target: src, message: 'This file has no video.' });
      const start = spec.start;
      const length = dur ? Math.min(spec.duration, Math.max(0, dur - start)) : spec.duration;
      if (length <= 0) throw makeError('validation', 'video.gif', { target: src, message: 'The start is after the end of the video.' });
      const scale = `fps=${spec.fps},scale=${spec.width}:-1:flags=lanczos`;
      const input = ['-ss', start.toFixed(6), '-t', length.toFixed(6), '-i', ffPath(src)];
      if (spec.format === 'webp') {
        if (!job.caps.webp) throw makeError('unavailable', 'video.gif', { message: 'The installed FFmpeg cannot write animated WebP (no libwebp_anim encoder).' });
        const tmp = await tempFile(job, 'webp');
        await ff(job, [...input, '-vf', scale, '-an', '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', '75', '-loop', '0', '-y', ffPath(tmp)], length, 'make the animated WebP');
        const w = await inspectWebp(tmp);
        if (!w || w.width !== spec.width || w.frames < 1) throw makeError('io', 'video.gif', { target: src, message: 'The animated WebP did not verify; nothing was saved.' });
        return { tmp, name: `${stem}.webp` };
      }
      const palette = await tempFile(job, 'png');
      await ff(job, [...input, '-vf', `${scale},palettegen=stats_mode=diff`, '-frames:v', '1', '-update', '1', '-y', ffPath(palette)], length, 'make the colour palette', { from: 0, to: 0.35 });
      const tmp = await tempFile(job, 'gif');
      await ff(job, [...input, '-i', ffPath(palette), '-lavfi', `${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, '-an', '-loop', '0', '-y', ffPath(tmp)], length, 'make the GIF', { from: 0.35, to: 1 });
      await fsp.rm(palette, { force: true });
      job.helpers.committed(palette);
      const out = await probeMedia(job.ffprobe, tmp, { countFrames: true });
      if (out.formatName !== 'gif' || out.video?.width !== spec.width || !(out.video.frames && out.video.frames > 0)) throw makeError('io', 'video.gif', { target: src, message: 'The GIF did not verify; nothing was saved.' });
      return { tmp, name: `${stem}.gif` };
    }
    case 'contactSheet': {
      if (!v) throw makeError('unsupported', 'video.contactSheet', { target: src, message: 'This file has no video.' });
      if (!dur) throw makeError('unsupported', 'video.contactSheet', { target: src, message: 'The length of this video is unknown, so frames cannot be spread over it.' });
      const size = displaySize(v);
      if (!size) throw makeError('unsupported', 'video.contactSheet', { target: src, message: 'The picture size of this video is unknown.' });
      const n = spec.columns * spec.rows;
      const interval = dur / n;
      const offset = interval / 2;
      const g = sheetGeometry(size, spec);
      const ext = spec.format === 'png' ? 'png' : 'jpg';
      const build = (stamps: boolean) => {
        const font = Math.max(11, Math.round(spec.tileWidth / 14));
        const text = stamps ? `,drawtext=text='%{pts\\:hms\\:${offset.toFixed(3)}}':x=6:y=h-th-6:fontsize=${font}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4` : '';
        return `fps=${(n / dur).toFixed(8)},scale=${spec.tileWidth}:-2${text},tile=${spec.columns}x${spec.rows}:padding=${g.padding}:margin=${g.margin}:color=0x15181d`;
      };
      let stamps = spec.timestamps;
      if (stamps && !job.caps.drawtext) {
        stamps = false;
        job.notes.add('Time stamps were left out: the installed FFmpeg has no drawtext filter.');
      }
      const run = async (withStamps: boolean) => {
        const tmp = await tempFile(job, ext);
        await ff(job, ['-ss', offset.toFixed(6), '-i', ffPath(src), '-an', '-sn', '-vf', build(withStamps), '-frames:v', '1', '-update', '1', ...(ext === 'jpg' ? ['-q:v', '3'] : []), '-y', ffPath(tmp)], dur - offset, 'make the contact sheet');
        return tmp;
      };
      let tmp: string;
      try {
        tmp = await run(stamps);
      } catch (err) {
        // drawtext needs a font (fontconfig); without one, make the sheet without time stamps and say so.
        if (!stamps || toOrbisError(err, 'video').category === 'cancelled') throw err;
        job.notes.add(`Time stamps were left out: FFmpeg could not draw text (${(err as Error).message.replace(/^FFmpeg could not make the contact sheet: /, '').slice(0, 160)}).`);
        tmp = await run(false);
      }
      const out = await probeMedia(job.ffprobe, tmp);
      if (out.video?.width !== g.width || out.video?.height !== g.height) throw makeError('io', 'video.contactSheet', { target: src, message: `The contact sheet is ${out.video?.width}×${out.video?.height} instead of ${g.width}×${g.height}; nothing was saved.` });
      return { tmp, name: `${stem} contact sheet.${ext}` };
    }
    case 'frame': {
      if (!v) throw makeError('unsupported', 'video.frame', { target: src, message: 'This file has no video.' });
      const t = dur ? Math.min(spec.time, Math.max(0, dur - 0.001)) : spec.time;
      const tmp = await tempFile(job, 'png');
      await ff(job, ['-ss', t.toFixed(6), '-i', ffPath(src), '-an', '-sn', '-frames:v', '1', '-update', '1', '-y', ffPath(tmp)], undefined, 'save the frame');
      const out = await probeMedia(job.ffprobe, tmp);
      const size = displaySize(v);
      if (out.formatName !== 'png_pipe' && out.video?.codec !== 'png') throw makeError('io', 'video.frame', { target: src, message: 'The frame did not verify as a PNG; nothing was saved.' });
      if (size && (out.video?.width !== size.width || out.video?.height !== size.height)) throw makeError('io', 'video.frame', { target: src, message: 'The frame has an unexpected size; nothing was saved.' });
      return { tmp, name: `${stem} frame ${fileTimecode(t)}.png` };
    }
    case 'rotate': {
      if (!v) throw makeError('unsupported', 'video.rotate', { target: src, message: 'This file has no video.' });
      const lossless = spec.mode === 'auto' && LOSSLESS_ROTATE_EXTS.has(srcExt);
      const cur = v.rotation ?? 0;
      if (lossless) {
        // Display rotation is counter-clockwise; the requested turn is clockwise.
        const ccw = normDeg(cur - spec.rotate);
        const tmp = await tempFile(job, srcExt);
        try {
          await ff(job, ['-display_rotation', String(ccw), ...(spec.hflip ? ['-display_hflip'] : []), ...(spec.vflip ? ['-display_vflip'] : []), '-i', ffPath(src), '-map', '0', '-c', 'copy', '-movflags', '+faststart', '-y', ffPath(tmp)], dur, 'rotate the video');
          const out = await probeMedia(job.ffprobe, tmp);
          const flips = spec.hflip !== spec.vflip;
          const okRot = flips ? out.video?.mirrored === true : normDeg(out.video?.rotation ?? 0) === ccw;
          if (!okRot || !close(out.durationSec ?? 0, dur ?? 0, 0.5)) throw makeError('io', 'video.rotate', { target: src, message: 'The rotated file did not verify; nothing was saved.' });
          return { tmp, name: `${stem} (rotated).${srcExt}` };
        } catch (err) {
          if (!/Unrecognized option|Option not found|display_rotation/i.test((err as Error).message)) throw err;
          job.notes.add('This FFmpeg cannot change the rotation without re-encoding (it is older than 6.0), so the video was re-encoded.');
          await fsp.rm(tmp, { force: true });
          job.helpers.committed(tmp);
        }
      }
      requireEncoders(job, ['libx264', 'aac']);
      const filters = [spec.rotate === 90 ? 'transpose=1' : spec.rotate === 270 ? 'transpose=2' : spec.rotate === 180 ? 'hflip,vflip' : '', spec.hflip ? 'hflip' : '', spec.vflip ? 'vflip' : ''].filter(Boolean).join(',');
      const tmp = await tempFile(job, 'mp4');
      await ff(job, ['-i', ffPath(src), '-map', `0:${v.index}`, '-map', '0:a?', '-vf', filters, ...H264_ARGS, '-y', ffPath(tmp)], dur, 'rotate the video');
      const out = await probeMedia(job.ffprobe, tmp);
      const before = displaySize(v);
      const after = out.video && displaySize(out.video);
      const swapped = spec.rotate % 180 === 90;
      if (!before || !after || (swapped ? after.width !== before.height || after.height !== before.width : after.width !== before.width || after.height !== before.height)) throw makeError('io', 'video.rotate', { target: src, message: 'The rotated video has an unexpected size; nothing was saved.' });
      if (spec.mode === 'auto' && !LOSSLESS_ROTATE_EXTS.has(srcExt)) job.notes.add(`${srcExt.toUpperCase()} files cannot store a rotation, so the video was re-encoded to MP4 (H.264).`);
      return { tmp, name: `${stem} (rotated).mp4` };
    }
  }
}

async function runJoin(job: Job, spec: Extract<VideoToolSpec, { tool: 'join' }>, sources: string[]): Promise<{ tmp: string; name: string }> {
  const probes: ProbeResult[] = [];
  for (const s of sources) probes.push(await probeMedia(job.ffprobe, s));
  const check = compareForJoin(sources, probes);
  const total = check.totalSec;
  const first = probes[0]!;
  const stem = stemOf(sources[0]!);
  if (spec.mode === 'copy') {
    if (!check.match) throw makeError('validation', 'video.join', { message: `These files cannot be joined without re-encoding: ${check.reasons[0]}` });
    const ext = extOf(sources[0]!) || 'mkv';
    const list = await tempFile(job, 'txt');
    await fsp.writeFile(list, `ffconcat version 1.0\n${sources.map(concatListLine).join('\n')}\n`, { flag: 'wx' });
    const tmp = await tempFile(job, ext);
    await ff(job, ['-f', 'concat', '-safe', '0', '-i', ffPath(list), '-map', '0', '-c', 'copy', ...(['mp4', 'm4v', 'mov', 'm4a'].includes(ext) ? ['-movflags', '+faststart'] : []), '-y', ffPath(tmp)], total, 'join the files');
    await fsp.rm(list, { force: true });
    job.helpers.committed(list);
    await verifyJoin(job, tmp, total);
    return { tmp, name: `${stem} (joined).${ext}` };
  }
  // Re-encode: every input scaled and padded to the first video's size and frame rate, audio resampled; silence where a file has none.
  const hasVideo = probes.every((p) => p.video);
  if (!hasVideo && probes.some((p) => p.video)) throw makeError('validation', 'video.join', { message: 'Videos and audio-only files cannot be joined together.' });
  const anyAudio = probes.some((p) => p.audio);
  requireEncoders(job, hasVideo ? ['libx264', 'aac'] : ['aac']);
  const size = hasVideo ? displaySize(first.video!) : undefined;
  const W = size ? Math.max(2, Math.round(size.width / 2) * 2) : 0;
  const H = size ? Math.max(2, Math.round(size.height / 2) * 2) : 0;
  const fps = first.video?.fps ? Math.round(first.video.fps * 1000) / 1000 : 30;
  const inputs: string[] = [];
  sources.forEach((s) => inputs.push('-i', ffPath(s)));
  const chains: string[] = [];
  const pads: string[] = [];
  let extra = sources.length;
  probes.forEach((p, i) => {
    if (hasVideo) {
      chains.push(`[${i}:${p.video!.index}]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${i}]`);
      pads.push(`[v${i}]`);
    }
    if (anyAudio) {
      let a = `${i}:${p.audio?.index ?? 0}`;
      if (!p.audio) {
        inputs.push('-f', 'lavfi', '-t', String(p.durationSec ?? 1), '-i', 'anullsrc=r=48000:cl=stereo');
        a = `${extra++}:a`;
      }
      chains.push(`[${a}]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
      pads.push(`[a${i}]`);
    }
  });
  const graph = `${chains.join(';')};${pads.join('')}concat=n=${sources.length}:v=${hasVideo ? 1 : 0}:a=${anyAudio ? 1 : 0}${hasVideo ? '[v]' : ''}${anyAudio ? '[a]' : ''}`;
  const ext = hasVideo ? 'mp4' : 'm4a';
  const tmp = await tempFile(job, ext);
  await ff(job, [...inputs, '-filter_complex', graph, ...(hasVideo ? ['-map', '[v]'] : []), ...(anyAudio ? ['-map', '[a]'] : []), ...(hasVideo ? H264_ARGS : ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart']), '-y', ffPath(tmp)], total, 'join the files');
  await verifyJoin(job, tmp, total);
  return { tmp, name: `${stem} (joined).${ext}` };
}

async function verifyJoin(job: Job, tmp: string, total: number): Promise<void> {
  const out = await probeMedia(job.ffprobe, tmp);
  if (!close(out.durationSec ?? 0, total, Math.max(1, total * 0.03))) throw makeError('io', 'video.join', { message: `The joined file is ${(out.durationSec ?? 0).toFixed(1)} s long instead of about ${total.toFixed(1)} s; nothing was saved.` });
}

export function makeVideoToolsRunner(deps: { markRunning: (rec: OperationRecord) => void; onCreated?: (p: string) => void }): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    validateVideoToolRequest(req);
    const spec = VideoToolSpecSchema.parse((req.params ?? {}).spec);
    const dest = rec.destination!;
    const dst = await fsp.stat(dest).catch(() => undefined);
    if (!dst?.isDirectory()) throw makeError('not_found', 'video.tool', { target: dest, message: 'The folder for the new files does not exist.' });
    const info = await detectFfmpeg();
    const caps = toolsCaps(info);
    if (!caps.available) throw makeError('unavailable', 'video.tool', { message: caps.reason });
    rec.pausable = PAUSE_SUPPORTED;
    if (!PAUSE_SUPPORTED) rec.pauseUnavailable = PAUSE_UNAVAILABLE_REASON;
    const units = spec.tool === 'join' ? [rec.sources] : rec.sources.map((s) => [s]);
    rec.progress = { totalItems: units.length, completedItems: 0, completedBytes: 0, fraction: 0 };
    deps.markRunning(rec);
    const job: Job = { rec, ctx, helpers, ffmpeg: info.path!, ffprobe: info.ffprobe!, caps, dest, index: 0, count: units.length, notes: new Set(), encoders: new Set(info.encoders ?? []) };
    const created: Array<{ source: string; destination: string }> = [];
    for (const [i, unit] of units.entries()) {
      await ctx.gate();
      job.index = i;
      const src = unit[0]!;
      rec.progress.currentItem = spec.tool === 'join' ? `${unit.length} files` : path.basename(src);
      rec.progress.etaSec = undefined;
      helpers.tick(0, 0, rec.progress.currentItem);
      let tmp: string | undefined;
      try {
        for (const s of unit) {
          const st = await fsp.stat(s).catch(() => undefined);
          if (!st?.isFile()) throw makeError('not_found', 'video.tool', { target: s, message: `${path.basename(s)} is not a file that exists.` });
        }
        const r = spec.tool === 'join' ? await runJoin(job, spec, unit) : await runOne(job, spec, src);
        tmp = r.tmp;
        const v = validateName(r.name);
        const name = v.valid ? r.name : `video.${path.extname(r.name).slice(1) || 'mp4'}`;
        const final = await commitUnique(r.tmp, dest, name, helpers);
        deps.onCreated?.(final);
        created.push({ source: src, destination: final });
        if (spec.tool === 'join') for (const s of unit) rec.results.push({ source: s, destination: final, status: 'done' });
        else rec.results.push({ source: src, destination: final, status: 'done' });
      } catch (err) {
        if (tmp) {
          await fsp.rm(tmp, { force: true }).catch(() => undefined);
          helpers.committed(tmp);
        }
        const shape = toOrbisError(err, 'video.tool', src, 'no');
        if (shape.category === 'cancelled' || ctx.signal.aborted) throw err;
        for (const s of unit) rec.results.push({ source: s, status: 'failed', error: shape });
      }
      rec.progress.fraction = (i + 1) / units.length;
      rec.progress.etaSec = undefined;
      helpers.tick(0, 1, rec.progress.currentItem);
    }
    if (job.notes.size) rec.notes = [...(rec.notes ?? []), ...job.notes];
    rec.undo = created.length ? { kind: 'transfer', mode: 'copy', items: created } : { kind: 'none', reason: 'No new file was made.' };
  };
}
