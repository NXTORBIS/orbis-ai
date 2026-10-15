import { createStore } from './store';
import { call } from '../api';
import { toast, toastError } from './app';
import type { ClipPeek } from '../../shared/powerTools';
import type { FileEntry } from '../../shared/model';

/**
 * What the system clipboard holds, as seen by the main process ("clip:peek"):
 * file items (from Orbis Files, another file manager or a list of paths), an
 * image, or text. Refreshed when the window gets the focus (the only time
 * another program can have changed it), every few seconds while the window is
 * focused, after Orbis Files writes to it, and right before a paste. Paste
 * itself always reads it again, so a stale value only affects whether menu
 * items look available.
 */

export const clip = createStore<{ peek: ClipPeek | null; at: number }>({ peek: null, at: 0 });

let inflight: Promise<ClipPeek | null> | null = null;
/** Read the clipboard again; `fresh` never reuses a read that started earlier (a paste must see the latest copy). */
export function refreshClipboard(fresh = false): Promise<ClipPeek | null> {
  if (inflight && !fresh) return inflight;
  const p = call<ClipPeek>('clip:peek').then(
    (peek) => {
      if (JSON.stringify(clip.get().peek) !== JSON.stringify(peek)) clip.set({ peek, at: Date.now() });
      return peek;
    },
    () => null,
  ).finally(() => {
    if (inflight === p) inflight = null;
  });
  inflight = p;
  return p;
}

let watching = false;
/** Keep the peek fresh while the window is in use (cheap: formats and text only; images are not decoded). */
export function startClipboardWatch(): void {
  if (watching || typeof window === 'undefined' || !window.orbis) return;
  watching = true;
  window.addEventListener('focus', () => void refreshClipboard());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void refreshClipboard());
  setInterval(() => {
    if (document.visibilityState === 'visible' && document.hasFocus()) void refreshClipboard();
  }, 3000);
  void refreshClipboard();
}

/** Whether a paste may find something on the system clipboard (true while it is not known yet). */
export function systemClipboardHasContent(): boolean {
  const p = clip.get().peek;
  return !p || !!(p.files || p.image || p.text);
}

export const hasClipboardImage = (): boolean => !!clip.get().peek?.image;
export const hasClipboardText = (): boolean => !!clip.get().peek?.text;

/** "Copy image": the image itself on the clipboard (decoded by the window when the platform codec cannot read it). */
export async function copyImageToClipboard(entry: FileEntry): Promise<void> {
  try {
    let r = await call<{ width: number; height: number } | { needsWindowDecode: true }>('clip:copyImage', { path: entry.path });
    if ('needsWindowDecode' in r) {
      const png = await decodeToPng(entry.path);
      r = await call<{ width: number; height: number }>('clip:writeImagePng', { path: entry.path, pngBase64: png });
    }
    toast({ level: 'success', title: `Copied the image ${entry.name}`, detail: `${r.width} × ${r.height} pixels. Paste it into another program, or into a folder as a PNG file.` });
    void refreshClipboard();
  } catch (err) {
    toastError(err, 'Image not copied');
  }
}

async function decodeToPng(p: string): Promise<string> {
  const img = new Image();
  img.decoding = 'async';
  img.src = `orbis-media://f/${encodeURIComponent(p)}`;
  await img.decode().catch(() => {
    throw new Error('This image could not be decoded.');
  });
  if (img.naturalWidth * img.naturalHeight > 100_000_000) throw new Error('Images over 100 megapixels are not copied to the clipboard.');
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d');
  if (!g) throw new Error('The image could not be drawn.');
  g.drawImage(img, 0, 0);
  const url = c.toDataURL('image/png');
  return url.slice(url.indexOf(',') + 1);
}
