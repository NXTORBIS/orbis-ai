/**
 * Perceptual "difference hash" (dHash) shared by the main process (PNG/JPEG
 * decoded natively) and the renderer (other formats decoded by Chromium).
 * Similar images have hashes a few bits apart. A similarity signal only.
 */

export interface Bitmap {
  /** Raw pixels, 4 bytes per pixel. `order` says where red and blue are. */
  data: Uint8Array;
  width: number;
  height: number;
  order: 'rgba' | 'bgra';
}

export function dHash(bmp: Bitmap): bigint {
  if (bmp.width !== 9 || bmp.height !== 8) throw new Error('dHash needs a 9×8 bitmap');
  const r = bmp.order === 'rgba' ? 0 : 2;
  const b = bmp.order === 'rgba' ? 2 : 0;
  const lum = (x: number, y: number) => {
    const i = (y * 9 + x) * 4;
    return 0.299 * bmp.data[i + r]! + 0.587 * bmp.data[i + 1]! + 0.114 * bmp.data[i + b]!;
  };
  let h = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h = (h << 1n) | (lum(x, y) > lum(x + 1, y) ? 1n : 0n);
  return h;
}

/** Average colour of the 9×8 bitmap (red, green, blue, 0–255). */
export type Tone = [number, number, number];

export function meanTone(bmp: Bitmap): Tone {
  const r = bmp.order === 'rgba' ? 0 : 2;
  const b = bmp.order === 'rgba' ? 2 : 0;
  const sum: Tone = [0, 0, 0];
  const n = bmp.width * bmp.height;
  for (let i = 0; i < n; i++) {
    sum[0] += bmp.data[i * 4 + r]!;
    sum[1] += bmp.data[i * 4 + 1]!;
    sum[2] += bmp.data[i * 4 + b]!;
  }
  return [Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)];
}

export function toneDistance(a: Tone, b: Tone): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Largest average-colour difference still counted as similar. dHash only records
 * which neighbour is brighter, so smooth gradients and flat areas of completely
 * different colours share a hash; the colour check keeps them apart while
 * re-encoded, resized and lightly edited copies (a few levels apart) still match.
 */
export function toneLimit(threshold: number): number {
  return 40 + threshold * 3;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    x &= x - 1n;
    n++;
  }
  return n;
}

export interface SimilarGroup {
  items: Array<{ path: string; size: number; modifiedMs: number; distance: number }>;
  /** Largest distance between the first item and any other member (0 = pixel-identical at 9×8). */
  maxDistance: number;
}


/**
 * Group items whose hashes are within `threshold` bits of each other (single-link via union-find).
 * Items that carry an average colour (`tone`) are also required to be close in colour.
 */
export function groupByHash(items: Array<{ path: string; hash: bigint; size: number; modifiedMs: number; tone?: Tone }>, threshold: number): SimilarGroup[] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const maxTone = toneLimit(threshold);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      if (hamming(a.hash, b.hash) > threshold) continue;
      if (a.tone && b.tone && toneDistance(a.tone, b.tone) > maxTone) continue;
      parent[find(j)] = find(i);
    }
  }
  const byRoot = new Map<number, number[]>();
  items.forEach((_, i) => byRoot.set(find(i), [...(byRoot.get(find(i)) ?? []), i]));
  const groups: SimilarGroup[] = [];
  for (const idx of byRoot.values()) {
    if (idx.length < 2) continue;
    const first = items[idx[0]!]!;
    const members = idx.map((i) => ({ path: items[i]!.path, size: items[i]!.size, modifiedMs: items[i]!.modifiedMs, distance: hamming(first.hash, items[i]!.hash) }));
    groups.push({ items: members, maxDistance: Math.max(...members.map((m) => m.distance)) });
  }
  return groups.sort((a, b) => a.maxDistance - b.maxDistance || b.items.length - a.items.length);
}

