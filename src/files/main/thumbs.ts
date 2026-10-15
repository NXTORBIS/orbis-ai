import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { THUMB_RENDER_VERSION, thumbKindForExt, VIDEO_THUMB_EXT_LIST, type ThumbKind } from '../shared/thumbKinds';

/**
 * Thumbnail cache shared by the orbis-thumb protocol (images, decoded in the
 * main process) and thumbnails the window draws (video poster frames, PDF
 * first pages, SVG, fonts, text) and stores here. Keys include size and
 * modification time, so a changed file never shows an old thumbnail.
 */

export const VIDEO_THUMB_EXTS = new Set(VIDEO_THUMB_EXT_LIST);
/** Image formats the platform codec may not decode; the renderer can, and stores the result. */
export const RENDERER_IMAGE_THUMB_EXTS = new Set(['gif', 'webp', 'bmp', 'avif', 'ico', 'png', 'jpg', 'jpeg']);
/** Kinds only the window can draw: the protocol serves them from the cache and never decodes the file itself. */
export const WINDOW_ONLY_KINDS: ReadonlySet<ThumbKind> = new Set(['video', 'pdf', 'svg', 'font', 'text']);

export function clampThumbSize(n: number): number {
  return Math.min(512, Math.max(32, Math.round(n) || 160));
}

export function thumbKey(p: string, size: number, mtimeMs: number, bytes: number, kind: ThumbKind | undefined = thumbKindForExt(path.extname(p).slice(1))): string {
  const version = kind ? THUMB_RENDER_VERSION[kind] : undefined;
  return crypto.createHash('sha1').update(`${p}|${bytes}|${mtimeMs}|${clampThumbSize(size)}${version ? `|${version}` : ''}`).digest('hex');
}

export async function cachedThumbPath(dir: string, p: string, size: number): Promise<{ file: string; exists: boolean } | undefined> {
  const st = await fsp.stat(p).catch(() => undefined);
  if (!st?.isFile()) return undefined;
  const file = path.join(dir, `${thumbKey(p, size, st.mtimeMs, st.size)}.jpg`);
  const exists = !!(await fsp.stat(file).catch(() => undefined));
  return { file, exists };
}

/** Whether the window may store a thumbnail for this file (by extension). */
export function storableThumb(p: string): boolean {
  const ext = path.extname(p).slice(1).toLowerCase();
  const kind = thumbKindForExt(ext);
  return VIDEO_THUMB_EXTS.has(ext) || RENDERER_IMAGE_THUMB_EXTS.has(ext) || (!!kind && WINDOW_ONLY_KINDS.has(kind));
}

/** Store a renderer-generated thumbnail after validating it is a real JPEG of sane size. */
export async function storeRendererThumb(dir: string, p: string, size: number, jpeg: Buffer): Promise<void> {
  if (!storableThumb(p)) throw new Error('Thumbnails are stored only for images, videos, PDFs, SVG, fonts and text files.');
  if (jpeg.length < 100 || jpeg.length > 2 * 1024 * 1024 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Not a valid JPEG thumbnail.');
  const target = await cachedThumbPath(dir, p, size);
  if (!target) throw new Error('The file no longer exists.');
  await fsp.mkdir(dir, { recursive: true });
  const tmp = `${target.file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, jpeg);
  await fsp.rename(tmp, target.file);
}
