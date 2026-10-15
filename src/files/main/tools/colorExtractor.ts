import fsp from 'node:fs/promises';
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import { requireAbsolute } from '../fs/paths';
import { rgbToHsl, rgbToHex, type ExtractedColor, type ColorPalette } from '../../shared/colorExtract';
import { nativeImage } from 'electron';

/**
 * Color palette extraction from images using k-means clustering.
 *
 * Uses Electron's nativeImage to decode the image into raw RGBA pixel data,
 * then runs k-means on a down-sampled set of pixels for performance.
 */

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB
const SAMPLE_PIXELS = 10_000; // max pixels to sample for k-means
const MAX_ITERATIONS = 20;

interface RGB { r: number; g: number; b: number }

function samplePixels(buf: Buffer, width: number, height: number, maxSamples: number): RGB[] {
  const total = width * height;
  const step = Math.max(1, Math.floor(total / maxSamples));
  const pixels: RGB[] = [];
  for (let i = 0; i < total; i += step) {
    const offset = i * 4;
    const a = buf[offset + 3];
    // Skip fully transparent pixels
    if (a === undefined || a < 128) continue;
    pixels.push({ r: buf[offset]!, g: buf[offset + 1]!, b: buf[offset + 2]! });
  }
  return pixels;
}

function distance(a: RGB, b: RGB): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

function kMeans(pixels: RGB[], k: number): ExtractedColor[] {
  if (pixels.length === 0) return [];
  if (pixels.length <= k) {
    return pixels.map((p) => ({
      hex: rgbToHex(p.r, p.g, p.b),
      rgb: { r: p.r, g: p.g, b: p.b },
      hsl: rgbToHsl(p.r, p.g, p.b),
      weight: 1 / pixels.length,
    }));
  }

  // Initialize centroids with k-means++ for better initial placement
  const centroids: RGB[] = [];
  centroids.push(pixels[Math.floor(Math.random() * pixels.length)]!);
  for (let c = 1; c < k; c++) {
    const dists = pixels.map((p) => Math.min(...centroids.map((ce) => distance(p, ce))));
    const total = dists.reduce((a, b) => a + b, 0);
    if (total === 0) { centroids.push(pixels[Math.floor(Math.random() * pixels.length)]!); continue; }
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i]!;
      if (r <= 0) { idx = i; break; }
    }
    centroids.push(pixels[idx]!);
  }

  const assignments = new Int32Array(pixels.length);

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // Assign pixels to nearest centroid
    let changed = false;
    for (let i = 0; i < pixels.length; i++) {
      const px = pixels[i]!;
      let best = 0;
      let bestDist = distance(px, centroids[0]!);
      for (let c = 1; c < k; c++) {
        const d = distance(px, centroids[c]!);
        if (d < bestDist) { best = c; bestDist = d; }
      }
      if (assignments[i] !== best) { assignments[i] = best; changed = true; }
    }
    if (!changed) break;

    // Recompute centroids
    const sums = Array.from({ length: k }, () => ({ r: 0, g: 0, b: 0, count: 0 }));
    for (let i = 0; i < pixels.length; i++) {
      const px = pixels[i]!;
      const s = sums[assignments[i]!]!;
      s.r += px.r; s.g += px.g; s.b += px.b; s.count++;
    }
    for (let c = 0; c < k; c++) {
      const s = sums[c]!;
      if (s.count > 0) {
        centroids[c] = { r: Math.round(s.r / s.count), g: Math.round(s.g / s.count), b: Math.round(s.b / s.count) };
      }
    }
  }

  // Count cluster sizes for weight
  const counts = new Float64Array(k);
  for (let i = 0; i < pixels.length; i++) counts[assignments[i]!] = (counts[assignments[i]!] ?? 0) + 1;
  const totalCount = pixels.length;

  const colors: ExtractedColor[] = [];
  for (let c = 0; c < k; c++) {
    if ((counts[c] ?? 0) <= 0) continue;
    const { r, g, b } = centroids[c]!;
    colors.push({
      hex: rgbToHex(r, g, b),
      rgb: { r, g, b },
      hsl: rgbToHsl(r, g, b),
      weight: Math.round((counts[c]! / totalCount) * 10000) / 10000,
    });
  }

  // Sort by weight descending (most dominant first)
  colors.sort((a, b) => b.weight - a.weight);
  return colors;
}

type Channels = 'color:extract';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

export function colorExtractHandlers(): Handlers {
  return {
    'color:extract': async (p) => {
      const abs = requireAbsolute(p.path, 'color:extract');
      const stat = await fsp.stat(abs).catch((err) => {
        throw new OrbisError(toOrbisError(err, 'color:extract', abs, 'no'));
      });
      if (!stat.isFile()) throw makeError('validation', 'color:extract', { target: abs, message: 'Not a file.' });
      if (stat.size > MAX_FILE_BYTES) throw makeError('validation', 'color:extract', { target: abs, message: 'The image file is too large.' });

      const buf = await fsp.readFile(abs);
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) throw makeError('validation', 'color:extract', { target: abs, message: 'The file could not be decoded as an image.' });

      const size = img.getSize();
      const bitmap = img.toBitmap();
      const pixels = samplePixels(Buffer.from(bitmap), size.width, size.height, SAMPLE_PIXELS);
      const count = typeof p.count === 'number' ? p.count : 8;
      const colors = kMeans(pixels, count);

      const result: ColorPalette = {
        colors,
        imagePath: abs,
        width: size.width,
        height: size.height,
      };
      return result;
    },
  };
}
