import { z } from 'zod';

/**
 * Video tools run with the installed FFmpeg as 'video-tool' operations
 * (main/media/videoTools.ts). This module holds what both sides share: the
 * validated settings of each tool, the parser for `ffmpeg -progress pipe:1`
 * output with its time-left estimate, and time-code helpers for the dialogs.
 */

/** Longest GIF / animated WebP accepted (seconds): longer clips make huge files. */
export const GIF_MAX_SECONDS = 60;
/** Most videos joined in one operation. */
export const JOIN_MAX = 50;

const seconds = z.number().finite().min(0).max(30 * 24 * 3600);

export const TrimSpecSchema = z.object({
  tool: z.literal('trim'),
  start: seconds,
  end: seconds,
  /** fast: stream copy, cuts on keyframes (no quality loss, the start may move back to a keyframe); exact: re-encode, cuts on the exact frame. */
  mode: z.enum(['fast', 'exact']),
}).refine((s) => s.end > s.start, { message: 'The end must be after the start.' });

export const ExtractAudioSpecSchema = z.object({
  tool: z.literal('extractAudio'),
  /** copy: keep the audio stream as it is (in a container that holds that codec); otherwise encode. */
  format: z.enum(['copy', 'm4a', 'mp3', 'opus', 'flac', 'wav']),
});

export const GifSpecSchema = z.object({
  tool: z.literal('gif'),
  format: z.enum(['gif', 'webp']),
  start: seconds,
  duration: z.number().finite().positive().max(GIF_MAX_SECONDS),
  width: z.number().int().min(32).max(1920),
  fps: z.number().int().min(1).max(50),
});

export const ContactSheetSpecSchema = z.object({
  tool: z.literal('contactSheet'),
  columns: z.number().int().min(1).max(10),
  rows: z.number().int().min(1).max(12),
  /** Width of each picture in pixels (height follows the video's aspect ratio). */
  tileWidth: z.number().int().min(64).max(960),
  format: z.enum(['jpeg', 'png']),
  timestamps: z.boolean(),
});

export const FrameSpecSchema = z.object({ tool: z.literal('frame'), time: seconds });

export const JoinSpecSchema = z.object({
  tool: z.literal('join'),
  /** copy: concat demuxer (only when every stream matches); reencode: H.264/AAC MP4 at the first video's size. */
  mode: z.enum(['copy', 'reencode']),
});

export const RotateSpecSchema = z.object({
  tool: z.literal('rotate'),
  /** Clockwise degrees. */
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  hflip: z.boolean(),
  vflip: z.boolean(),
  /** auto: lossless display-matrix change where the container supports it (MP4/MOV), otherwise re-encode. */
  mode: z.enum(['auto', 'reencode']),
}).refine((s) => s.rotate !== 0 || s.hflip || s.vflip, { message: 'Choose a rotation or a flip.' });

export const VideoToolSpecSchema = z.union([TrimSpecSchema, ExtractAudioSpecSchema, GifSpecSchema, ContactSheetSpecSchema, FrameSpecSchema, JoinSpecSchema, RotateSpecSchema]);
export type VideoToolSpec = z.infer<typeof VideoToolSpecSchema>;
export type VideoToolId = VideoToolSpec['tool'];

/** Tools that act on exactly one source file. */
export const SINGLE_SOURCE_TOOLS: ReadonlySet<VideoToolId> = new Set(['trim', 'gif', 'frame']);

export const VIDEO_TOOL_LABEL: Record<VideoToolId, string> = {
  trim: 'Trim', extractAudio: 'Extract audio', gif: 'Make GIF', contactSheet: 'Contact sheet', frame: 'Save frame', join: 'Join videos', rotate: 'Rotate or flip',
};

/** Contact sheet geometry: each tile's size and the whole sheet (tile filter with padding and margin). */
export function sheetGeometry(src: { width: number; height: number }, spec: { columns: number; rows: number; tileWidth: number }): { tileWidth: number; tileHeight: number; width: number; height: number; padding: number; margin: number } {
  const padding = 6;
  const margin = 6;
  // FFmpeg's scale=W:-2 rounds W·ih/iw to the nearest multiple of 2.
  const tileHeight = Math.max(2, Math.round((spec.tileWidth * src.height) / (src.width * 2)) * 2);
  return { tileWidth: spec.tileWidth, tileHeight, padding, margin, width: spec.columns * spec.tileWidth + (spec.columns - 1) * padding + 2 * margin, height: spec.rows * tileHeight + (spec.rows - 1) * padding + 2 * margin };
}

/* ------------------------------------------------------------------ ffmpeg -progress */

/** One block of `-progress` output (ffmpeg writes key=value lines and ends each block with progress=continue|end). */
export interface ProgressSnapshot {
  /** Position written so far, in seconds of output time. */
  outTimeSec?: number;
  frame?: number;
  fps?: number;
  /** Encoding speed relative to real time (2 = twice as fast as playback). */
  speed?: number;
  totalSizeBytes?: number;
  end: boolean;
}

function hmsToSeconds(v: string): number | undefined {
  const m = /^(-)?(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(v.trim());
  if (!m) return undefined;
  const s = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
  return m[1] ? -s : s;
}

/**
 * Incremental parser for `ffmpeg -progress pipe:1`. Feed it chunks as they
 * arrive (lines may be split between chunks); it returns a snapshot for every
 * completed block. `N/A` values are left out; out_time_us is preferred, then
 * out_time_ms (which FFmpeg also writes in microseconds), then out_time.
 */
export class FfmpegProgressParser {
  private buf = '';
  private cur: Record<string, string> = {};

  push(chunk: string): ProgressSnapshot[] {
    this.buf += chunk;
    const out: ProgressSnapshot[] = [];
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (key === 'progress') {
        out.push(this.snapshot(value === 'end'));
        this.cur = {};
      } else this.cur[key] = value;
    }
    // A runaway line without a newline must not grow without bound.
    if (this.buf.length > 64 * 1024) this.buf = this.buf.slice(-1024);
    return out;
  }

  private snapshot(end: boolean): ProgressSnapshot {
    const c = this.cur;
    const num = (k: string) => {
      const v = c[k];
      if (v === undefined || v === 'N/A' || v === '') return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    let outTimeSec: number | undefined;
    const us = num('out_time_us') ?? num('out_time_ms');
    if (us !== undefined && us >= 0) outTimeSec = us / 1e6;
    else if (c.out_time && c.out_time !== 'N/A') {
      const t = hmsToSeconds(c.out_time);
      if (t !== undefined && t >= 0) outTimeSec = t;
    }
    const speedRaw = c.speed && c.speed !== 'N/A' ? Number(c.speed.replace(/x$/, '')) : undefined;
    return {
      outTimeSec,
      frame: num('frame'),
      fps: num('fps'),
      speed: speedRaw !== undefined && Number.isFinite(speedRaw) && speedRaw > 0 ? speedRaw : undefined,
      totalSizeBytes: num('total_size'),
      end,
    };
  }
}

/**
 * Seconds left for a job that has written `doneSec` of `totalSec` output
 * seconds after `activeMs` of running time (paused time excluded). Uses the
 * measured rate; undefined until there is enough to go on.
 */
export function estimateEta(doneSec: number, totalSec: number | undefined, activeMs: number): number | undefined {
  if (!totalSec || totalSec <= 0 || doneSec <= 0 || activeMs < 500) return undefined;
  const left = Math.max(0, totalSec - doneSec);
  const rate = doneSec / (activeMs / 1000); // output seconds per second
  if (!(rate > 0)) return undefined;
  return Math.round(left / rate);
}

/* ------------------------------------------------------------------ time codes */

/** "1:02:03.250" (hours only when needed), always with milliseconds. */
export function formatTimecode(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const f = ms % 1000;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}.${String(f).padStart(3, '0')}`;
}

/** The frame shown at `sec` for a constant frame rate (frame 0 starts at 0). */
export function frameAt(sec: number, fps: number): number {
  return Math.max(0, Math.floor(sec * fps + 1e-6));
}

/** Start time of a frame: snaps a time to the frame grid so marks match what is shown. */
export function snapToFrame(sec: number, fps: number | undefined): number {
  if (!fps || !Number.isFinite(fps) || fps <= 0) return Math.max(0, Math.round(sec * 1000) / 1000);
  return Math.round((frameAt(sec, fps) / fps) * 1e6) / 1e6;
}

/** Parse "75", "75.5", "1:15", "1:15.5", "0:01:15.500" into seconds; undefined when it is not a time. */
export function parseTimecode(input: string): number | undefined {
  const t = input.trim();
  if (!t) return undefined;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(t);
  if (!m) return undefined;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2]);
  const s = Number(m[3]);
  if (min >= 60 || s >= 60) return undefined;
  return h * 3600 + min * 60 + s;
}

/** A time for use in a file name ("0-01-02.500"): no colons, which Windows forbids. */
export function fileTimecode(sec: number): string {
  return formatTimecode(sec).replace(/:/g, '-');
}

/** "about 3 min left" style text for a number of seconds. */
export function formatEta(sec: number | undefined): string | undefined {
  if (sec === undefined || !Number.isFinite(sec)) return undefined;
  if (sec < 5) return 'a few seconds left';
  if (sec < 60) return `about ${Math.round(sec / 5) * 5} s left`;
  if (sec < 3600) return `about ${Math.round(sec / 60)} min left`;
  return `about ${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min left`;
}
