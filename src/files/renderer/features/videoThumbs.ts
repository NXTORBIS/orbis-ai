import { call } from '../api';
import type { ThumbKind } from '../../shared/thumbKinds';

/**
 * Thumbnails drawn by the window and stored in the main process's cache.
 * Video poster frames: the main process cannot decode video, but the
 * renderer's media stack can: a hidden <video> seeks to a representative
 * frame, it is drawn to a canvas, and the JPEG is stored in the thumbnail
 * cache. Likewise PDF first pages (PDF.js), SVG (an <img> from the sandboxed
 * orbis-media protocol: SVG in an image never runs scripts or loads anything),
 * fonts ("Aa" with a FontFace that exists only in this window) and the first
 * lines of text files. Anything that cannot be drawn keeps its file icon.
 */

const mediaUrl = (p: string) => `orbis-media://f/${encodeURIComponent(p)}`;
const queue: Array<() => Promise<void>> = [];
let active = 0;
const MAX_ACTIVE = 2;
const failed = new Set<string>();
const pending = new Map<string, Promise<boolean>>();

function pump(): void {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift()!;
    active++;
    void job().finally(() => {
      active--;
      pump();
    });
  }
}

export function captureFrame(path: string, size: number, timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    let done = false;
    const finish = (err?: Error, data?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      if (err) reject(err);
      else resolve(data!);
    };
    const timer = setTimeout(() => finish(new Error('Timed out decoding the video.')), timeoutMs);
    v.onerror = () => finish(new Error('This video cannot be decoded by the built-in player.'));
    v.onloadedmetadata = () => {
      const d = Number.isFinite(v.duration) ? v.duration : 0;
      v.currentTime = d > 0 ? Math.min(d * 0.1, 5) : 0;
    };
    v.onseeked = () => {
      try {
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (!w || !h) return finish(new Error('The video has no picture.'));
        const scale = Math.min(1, size / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * scale));
        c.height = Math.max(1, Math.round(h * scale));
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
        finish(undefined, c.toDataURL('image/jpeg', 0.82));
      } catch (err) {
        finish(err as Error);
      }
    };
    v.src = mediaUrl(path);
  });
}

/** Decode an image with Chromium (any format the browser supports). */
export function loadImage(path: string, timeoutMs = 15000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const timer = setTimeout(() => reject(new Error('Timed out decoding the image.')), timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error('This image cannot be decoded.'));
    };
    img.src = mediaUrl(path);
  });
}

export async function captureImage(path: string, size: number): Promise<string> {
  const img = await loadImage(path);
  const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

/** 9×8 RGBA pixels for perceptual hashing. */
export async function smallBitmap(path: string): Promise<{ data: Uint8Array; width: number; height: number; order: 'rgba' }> {
  const img = await loadImage(path);
  const c = document.createElement('canvas');
  c.width = 9;
  c.height = 8;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, 9, 8);
  return { data: new Uint8Array(g.getImageData(0, 0, 9, 8).data.buffer), width: 9, height: 8, order: 'rgba' };
}

/** Re-encode an image with Chromium's encoders (PNG, JPEG or WebP), optionally shrinking it. */
export async function encodeImageInRenderer(path: string, format: 'png' | 'jpeg' | 'webp', quality: number, maxDimension?: number): Promise<{ data: Uint8Array; width: number; height: number }> {
  const img = await loadImage(path, 60000);
  const scale = maxDimension ? Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight)) : 1;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const g = c.getContext('2d')!;
  if (format === 'jpeg') {
    g.fillStyle = '#ffffff'; // JPEG has no transparency
    g.fillRect(0, 0, c.width, c.height);
  }
  g.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, `image/${format}`, quality / 100));
  if (!blob || blob.type !== `image/${format}`) throw new Error(`This system cannot encode ${format.toUpperCase()} images.`);
  return { data: new Uint8Array(await blob.arrayBuffer()), width: c.width, height: c.height };
}

/** Generate and store a thumbnail the main process does not make (video frames, PDF pages, SVG, fonts, text, some image formats). */
export function ensureRendererThumb(path: string, size: number, kind: ThumbKind): Promise<boolean> {
  const capture = kind === 'video' ? captureFrame : kind === 'pdf' ? capturePdf : kind === 'font' ? captureFont : kind === 'text' ? captureText : kind === 'svg' ? captureSvg : captureImage;
  return ensureThumbWith(path, size, capture);
}

/** Generate and store a poster frame; resolves true when a thumbnail is now cached. */
export function ensureVideoThumb(path: string, size: number): Promise<boolean> {
  return ensureThumbWith(path, size, captureFrame);
}

/** Draw on a light "paper" card: document-like thumbnails (PDF, text, fonts) look the same in both themes. */
const PAPER = '#fbfbfc';
const INK = '#1f252d';

/** First page of a PDF, drawn by PDF.js. Encrypted or damaged PDFs reject (the file icon stays). */
export async function capturePdf(path: string, size: number): Promise<string> {
  const { openPdfForThumbnails } = await import('./pdfRender');
  const pdf = await openPdfForThumbnails(path);
  try {
    const page = await pdf.doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: size / Math.max(base.width, base.height) });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.floor(vp.width));
    c.height = Math.max(1, Math.floor(vp.height));
    const g = c.getContext('2d');
    if (!g) throw new Error('Canvas drawing is not available.');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    page.cleanup();
    return c.toDataURL('image/jpeg', 0.84);
  } finally {
    pdf.close();
  }
}

/**
 * An SVG drawn as an image from orbis-media:// (served with a sandboxing CSP; as an image it never runs
 * scripts or loads other resources) onto a light card, since JPEG has no transparency.
 */
export async function captureSvg(path: string, size: number): Promise<string> {
  const img = await loadImage(path);
  const iw = img.naturalWidth || size;
  const ih = img.naturalHeight || size;
  const scale = size / Math.max(iw, ih);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(iw * scale));
  c.height = Math.max(1, Math.round(ih * scale));
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas drawing is not available.');
  g.fillStyle = PAPER;
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}

let fontSeq = 0;

/** Load a font file into this window only (never installed): returns the FontFace and a remover. */
export async function loadFontFace(path: string, timeoutMs = 15000): Promise<{ family: string; face: FontFace; release: () => void }> {
  const family = `orbis-font-${++fontSeq}`;
  const face = new FontFace(family, `url("${mediaUrl(path)}")`);
  const timer = new Promise<never>((_r, reject) => setTimeout(() => reject(new Error('Timed out loading the font.')), timeoutMs));
  await Promise.race([face.load(), timer]);
  document.fonts.add(face);
  return { family, face, release: () => void document.fonts.delete(face) };
}

/** "Aa" drawn with the font itself. */
export async function captureFont(path: string, size: number): Promise<string> {
  const f = await loadFontFace(path);
  try {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    if (!g) throw new Error('Canvas drawing is not available.');
    g.fillStyle = PAPER;
    g.fillRect(0, 0, size, size);
    g.fillStyle = INK;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let px = Math.round(size * 0.46);
    g.font = `${px}px "${f.family}"`;
    const w = g.measureText('Aa').width;
    if (w > size * 0.86) {
      px = Math.floor((px * size * 0.86) / w);
      g.font = `${px}px "${f.family}"`;
    }
    g.fillText('Aa', size / 2, size / 2);
    return c.toDataURL('image/jpeg', 0.88);
  } finally {
    f.release();
  }
}

/** The first lines of a text or code file in a monospace font. Binary files reject. */
export async function captureText(path: string, size: number): Promise<string> {
  const r = await call<{ text: string; binary: boolean }>('fs:readText', { path, maxBytes: 4096 });
  if (r.binary) throw new Error('Binary data is not drawn as text.');
  const w = Math.round(size * 0.78);
  const h = size;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas drawing is not available.');
  const px = Math.max(7, Math.round(size / 24));
  await document.fonts.load(`${px}px "IBM Plex Mono"`).catch(() => undefined);
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, h);
  g.fillStyle = INK;
  g.font = `${px}px "IBM Plex Mono", ui-monospace, monospace`;
  g.textBaseline = 'top';
  const pad = Math.round(px * 1.1);
  const lh = Math.round(px * 1.4);
  const lines = r.text.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n');
  const max = Math.floor((h - pad * 2) / lh);
  g.save();
  g.beginPath();
  g.rect(pad, pad, w - pad * 2, h - pad * 2);
  g.clip();
  lines.slice(0, max).forEach((line, i) => g.fillText(line.replace(/[\u0000-\u001f]/g, ' ').slice(0, 200), pad, pad + i * lh));
  g.restore();
  return c.toDataURL('image/jpeg', 0.86);
}

function ensureThumbWith(path: string, size: number, capture: (p: string, s: number) => Promise<string>): Promise<boolean> {
  const key = `${path}|${size}`;
  if (failed.has(key)) return Promise.resolve(false);
  const existing = pending.get(key);
  if (existing) return existing;
  const p = new Promise<boolean>((resolve) => {
    queue.push(async () => {
      try {
        const dataUrl = await capture(path, size);
        await call('thumb:store', { path, size, jpegBase64: dataUrl.slice(dataUrl.indexOf(',') + 1) });
        resolve(true);
      } catch {
        failed.add(key);
        resolve(false);
      } finally {
        pending.delete(key);
      }
    });
    pump();
  });
  pending.set(key, p);
  return p;
}
