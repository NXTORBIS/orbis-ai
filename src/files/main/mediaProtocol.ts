import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { PREVIEWABLE_MIME } from './fs/sniff';
import { pathFromPreviewUrl } from './protocolPaths';
import { clampThumbSize, thumbKey, WINDOW_ONLY_KINDS } from './thumbs';
import { thumbKindForExt } from '../shared/thumbKinds';

/**
 * Responses of the two read-only preview protocols, kept apart from Electron
 * so they can be tested directly:
 *
 *  orbis-media://f/<absolute path>   known media types only (PREVIEWABLE_MIME,
 *    plus fonts for the font preview), regular files only, Range support,
 *    no-store, nosniff. SVG keeps a sandboxing CSP (no scripts, no external
 *    loads even when opened as a document). Raster images, video, SVG and
 *    fonts are CORS-enabled so the app's own window can draw them to a canvas
 *    (thumbnails) and load fonts with FontFace (font loads are CORS requests).
 *  orbis-thumb://t/<absolute path>?s=<size>   cached JPEG thumbnails.
 *
 * Both accept only clean absolute paths (`pathFromPreviewUrl`); adding a type
 * never widens which paths can be read.
 */

/** Font files, served only to the font preview and font thumbnails (never installed). */
export const FONT_MIME: Record<string, string> = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };

export function mediaMimeFor(p: string): string | undefined {
  const ext = path.extname(p).slice(1).toLowerCase();
  return PREVIEWABLE_MIME[ext] ?? FONT_MIME[ext];
}

export const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export async function mediaResponse(url: string, rangeHeader: string | null): Promise<Response> {
  try {
    const p = pathFromPreviewUrl(url);
    if (!p || !url.startsWith('orbis-media:')) return new Response('Bad path', { status: 400 });
    const mime = mediaMimeFor(p);
    if (!mime) return new Response('Unsupported type', { status: 415 });
    const st = await fsp.stat(p);
    if (!st.isFile()) return new Response('Not a file', { status: 404 });
    const headers: Record<string, string> = { 'content-type': mime, 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    if (mime === 'image/svg+xml') headers['content-security-policy'] = SVG_CSP;
    if (/^(image|video|font)\//.test(mime)) headers['access-control-allow-origin'] = '*';
    if (mime.startsWith('font/')) headers['content-security-policy'] = SVG_CSP;
    const m = rangeHeader ? /bytes=(\d*)-(\d*)/.exec(rangeHeader) : null;
    if (m && st.size > 0) {
      const start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${st.size}` } });
      const stream = Readable.toWeb(fs.createReadStream(p, { start, end })) as ReadableStream;
      return new Response(stream, { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': String(end - start + 1) } });
    }
    return new Response(Readable.toWeb(fs.createReadStream(p)) as ReadableStream, { status: 200, headers: { ...headers, 'content-length': String(st.size) } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

/** Decode and scale an image file to a JPEG of at most `size` px (the platform codec); undefined when it cannot. */
export type ThumbDecoder = (p: string, size: number) => Promise<Buffer | undefined>;

export async function thumbResponse(url: string, thumbDir: string, decode: ThumbDecoder): Promise<Response> {
  try {
    const p = pathFromPreviewUrl(url);
    if (!p || !url.startsWith('orbis-thumb:')) return new Response(null, { status: 400 });
    const size = clampThumbSize(Number(new URL(url).searchParams.get('s')));
    const kind = thumbKindForExt(path.extname(p).slice(1));
    const st = await fsp.stat(p);
    if (!st.isFile()) return new Response(null, { status: 415 });
    const cached = path.join(thumbDir, `${thumbKey(p, size, st.mtimeMs, st.size, kind)}.jpg`);
    const hit = await fsp.readFile(cached).catch(() => undefined);
    if (hit) return new Response(hit, { headers: { 'content-type': 'image/jpeg' } });
    // Video frames, PDF pages, SVG, fonts and text are drawn by the window (which stores them through IPC);
    // the main process never decodes them.
    if (kind && WINDOW_ONLY_KINDS.has(kind)) return new Response(null, { status: 404 });
    if (st.size > 200 * 1024 * 1024) return new Response(null, { status: 415 });
    const jpeg = await decode(p, size);
    if (!jpeg) return new Response(null, { status: 415 });
    await fsp.mkdir(thumbDir, { recursive: true });
    await fsp.writeFile(cached, jpeg).catch(() => undefined);
    return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
