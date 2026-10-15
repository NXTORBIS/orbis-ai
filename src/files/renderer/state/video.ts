import { createStore } from './store';
import { call } from '../api';
import { toastError } from './app';
import { startOperation } from '../actions';
import type { VideoToolSpec } from '../../shared/videoTools';

/**
 * Video tools in the window: what the installed FFmpeg can do (asked once),
 * the video previews currently shown (so "Save frame" can use the preview's
 * position), and starting a 'video-tool' operation.
 */

export interface VideoCaps {
  available: boolean;
  reason?: string;
  version?: string;
  webp: boolean;
  drawtext: boolean;
  h264: boolean;
  encoders: { m4a: boolean; mp3: boolean; opus: boolean; flac: boolean; wav: boolean; vp9: boolean };
  pause: boolean;
  pauseReason?: string;
}

export interface VideoProbe {
  path: string;
  durationSec?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  rotation: number;
  container: string;
  audioCopy: { ext: string; label: string } | null;
  losslessRotate: boolean;
}

export const videoCaps = createStore<{ caps: VideoCaps | null; loading: boolean }>({ caps: null, loading: false });

export async function loadVideoCaps(): Promise<VideoCaps | null> {
  const cur = videoCaps.get();
  if (cur.caps || cur.loading) return cur.caps;
  videoCaps.set({ loading: true });
  try {
    const caps = await call<VideoCaps>('video:caps');
    videoCaps.set({ caps, loading: false });
    return caps;
  } catch {
    videoCaps.set({ loading: false });
    return null;
  }
}

/** Why the video tools are unavailable (once known), else true. */
export function videoToolsReady(): true | string {
  const c = videoCaps.get().caps;
  if (!c) {
    void loadVideoCaps();
    return true; // not known yet: the dialog says so if FFmpeg is missing
  }
  return c.available ? true : c.reason ?? 'FFmpeg is not available.';
}

/** Video previews on screen (details panel), by path: "Save frame" uses their current position. */
const previews = new Map<string, HTMLVideoElement>();
export function registerPreview(path: string, el: HTMLVideoElement | null): void {
  if (el) previews.set(path, el);
  else previews.delete(path);
}
export function previewTime(path: string): number | undefined {
  const el = previews.get(path);
  return el && el.isConnected ? el.currentTime : undefined;
}

export async function runVideoTool(sources: string[], destination: string, spec: VideoToolSpec): Promise<boolean> {
  try {
    const rec = await startOperation({ type: 'video-tool', sources, destination, params: { spec }, conflictPolicy: 'keep-both', origin: `video-tools:${spec.tool}` });
    return !!rec;
  } catch (err) {
    toastError(err);
    return false;
  }
}
