import fsp from 'node:fs/promises';
import path from 'node:path';
import { sniffFile } from '../fs/sniff';

/**
 * Validation of a local background image (Customization → Appearance →
 * Background). Backgrounds are never fetched from the network: only an
 * absolute path to a regular, readable raster image whose content matches a
 * supported image format is accepted. A missing or unreadable file is
 * reported, never thrown, so rendering simply falls back to a plain surface.
 */

export const BACKGROUND_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp']);
export const MAX_BACKGROUND_BYTES = 40 * 1024 * 1024;
const MIME_OK = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']);

export type BackgroundCheck = { ok: true; path: string; mime: string; bytes: number; modifiedMs: number } | { ok: false; reason: string; missing?: boolean };

export async function checkBackgroundImage(p: string): Promise<BackgroundCheck> {
  if (!p) return { ok: false, reason: 'No image is selected.' };
  if (!path.isAbsolute(p) || p.includes('\0')) return { ok: false, reason: 'Backgrounds must be a local file given by its full path.' };
  const ext = path.extname(p).slice(1).toLowerCase();
  if (!BACKGROUND_EXTS.has(ext)) return { ok: false, reason: 'Use a PNG, JPEG, WebP, GIF, AVIF or BMP image.' };
  let st;
  try {
    st = await fsp.stat(p);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR'
      ? { ok: false, missing: true, reason: `The background image ${p} no longer exists. A plain background is shown instead.` }
      : { ok: false, reason: `The background image cannot be read (${code ?? 'error'}). A plain background is shown instead.` };
  }
  if (!st.isFile()) return { ok: false, reason: 'The background must be a file, not a folder.' };
  if (st.size === 0) return { ok: false, reason: 'The image file is empty.' };
  if (st.size > MAX_BACKGROUND_BYTES) return { ok: false, reason: `The image is larger than ${MAX_BACKGROUND_BYTES / 1024 / 1024} MB; choose a smaller one so scrolling stays smooth.` };
  try {
    const s = await sniffFile(p);
    if (s.family !== 'image' || !s.mime || !MIME_OK.has(s.mime)) return { ok: false, reason: `The file's content is not a supported image (${s.detected ?? 'unknown content'}).` };
    return { ok: true, path: p, mime: s.mime, bytes: st.size, modifiedMs: st.mtimeMs };
  } catch (err) {
    return { ok: false, reason: `The image could not be read (${(err as NodeJS.ErrnoException).code ?? (err as Error).message}).` };
  }
}
