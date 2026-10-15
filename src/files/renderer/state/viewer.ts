import { createStore } from './store';
import type { FileEntry } from '../../shared/model';

/**
 * The full-window media viewer (one per window). Opened from a preview's
 * "Open in viewer" button or the Start slideshow command; `slideshow` starts
 * it playing.
 */
export interface ViewerState {
  open: { entries: FileEntry[]; index: number; slideshow: boolean; key: number } | null;
}

export const viewer = createStore<ViewerState>({ open: null });
let seq = 0;

export function openViewer(entries: FileEntry[], index: number, opts: { slideshow?: boolean } = {}): void {
  if (!entries.length) return;
  viewer.set({ open: { entries, index: Math.max(0, Math.min(entries.length - 1, index)), slideshow: !!opts.slideshow, key: ++seq } });
}

export function closeViewer(): void {
  viewer.set({ open: null });
}

export function setViewerIndex(index: number): void {
  const o = viewer.get().open;
  if (o) viewer.set({ open: { ...o, index } });
}

/** What the viewer and the slideshow show: images Chromium decodes, and videos. */
export const VIEWER_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico', 'svg']);
export const VIEWER_VIDEO_EXTS = new Set(['mp4', 'm4v', 'webm', 'mkv', 'mov', 'ogv']);
export function viewerKind(e: FileEntry): 'image' | 'video' | undefined {
  const file = e.kind === 'file' || (e.kind === 'symlink' && e.linkTargetKind === 'file');
  if (!file) return undefined;
  return VIEWER_IMAGE_EXTS.has(e.ext) ? 'image' : VIEWER_VIDEO_EXTS.has(e.ext) ? 'video' : undefined;
}

export interface SlideshowPrefs {
  intervalSec: number;
  shuffle: boolean;
  loop: boolean;
  includeVideos: boolean;
}

export const SLIDESHOW_INTERVALS = [2, 3, 5, 8, 10, 15, 30];
const PREFS_KEY = 'orbis.slideshow.v1';
export const DEFAULT_SLIDESHOW: SlideshowPrefs = { intervalSec: 5, shuffle: false, loop: true, includeVideos: false };

/** Per-window convenience settings (kept in this window's storage; never required). */
export function loadSlideshowPrefs(): SlideshowPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<SlideshowPrefs> | null;
    if (!raw || typeof raw !== 'object') return DEFAULT_SLIDESHOW;
    return {
      intervalSec: SLIDESHOW_INTERVALS.includes(Number(raw.intervalSec)) ? Number(raw.intervalSec) : DEFAULT_SLIDESHOW.intervalSec,
      shuffle: typeof raw.shuffle === 'boolean' ? raw.shuffle : DEFAULT_SLIDESHOW.shuffle,
      loop: typeof raw.loop === 'boolean' ? raw.loop : DEFAULT_SLIDESHOW.loop,
      includeVideos: typeof raw.includeVideos === 'boolean' ? raw.includeVideos : DEFAULT_SLIDESHOW.includeVideos,
    };
  } catch {
    return DEFAULT_SLIDESHOW;
  }
}

export function saveSlideshowPrefs(p: SlideshowPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the settings last for this session */
  }
}

/** A random order of 0…n-1 that starts with `first`. */
export function shuffledOrder(n: number, first: number, random: () => number = Math.random): number[] {
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return n ? [first, ...rest] : [];
}
