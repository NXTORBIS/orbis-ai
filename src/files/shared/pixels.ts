/**
 * Pixel operations on 4-byte-per-pixel bitmaps (RGBA from a canvas, or BGRA
 * from the platform codec — every operation here treats the four channels
 * alike, so channel order does not matter). Used by the main process (platform
 * codec) and the renderer (Chromium canvas) so both paths produce the same
 * geometry. Pure functions: inputs are never modified.
 */

export interface Bitmap {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

function alloc(width: number, height: number): Bitmap {
  return { data: new Uint8Array(width * height * 4), width, height };
}

function check(img: Bitmap): void {
  if (img.width < 1 || img.height < 1 || img.data.length < img.width * img.height * 4) throw new Error('Invalid bitmap.');
}

/** Rotate clockwise by 90, 180 or 270 degrees. */
export function rotate(img: Bitmap, degrees: 0 | 90 | 180 | 270): Bitmap {
  check(img);
  if (degrees === 0) return { data: new Uint8Array(img.data), width: img.width, height: img.height };
  const { width: w, height: h, data: src } = img;
  const out = degrees === 180 ? alloc(w, h) : alloc(h, w);
  const d = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number;
      let ny: number;
      if (degrees === 90) {
        nx = h - 1 - y;
        ny = x;
      } else if (degrees === 180) {
        nx = w - 1 - x;
        ny = h - 1 - y;
      } else {
        nx = y;
        ny = w - 1 - x;
      }
      const si = (y * w + x) * 4;
      const di = (ny * out.width + nx) * 4;
      d[di] = src[si]!;
      d[di + 1] = src[si + 1]!;
      d[di + 2] = src[si + 2]!;
      d[di + 3] = src[si + 3]!;
    }
  }
  return out;
}

/** Mirror left-right (horizontal) or top-bottom (vertical). */
export function flip(img: Bitmap, axis: 'horizontal' | 'vertical'): Bitmap {
  check(img);
  const { width: w, height: h, data: src } = img;
  const out = alloc(w, h);
  const row = w * 4;
  for (let y = 0; y < h; y++) {
    if (axis === 'vertical') {
      out.data.set(src.subarray((h - 1 - y) * row, (h - y) * row), y * row);
      continue;
    }
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = (y * w + (w - 1 - x)) * 4;
      out.data[di] = src[si]!;
      out.data[di + 1] = src[si + 1]!;
      out.data[di + 2] = src[si + 2]!;
      out.data[di + 3] = src[si + 3]!;
    }
  }
  return out;
}

/** Copy a rectangle (clamped to the image). */
export function crop(img: Bitmap, x: number, y: number, w: number, h: number): Bitmap {
  check(img);
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
  const cw = Math.max(1, Math.min(img.width - x0, Math.floor(w)));
  const ch = Math.max(1, Math.min(img.height - y0, Math.floor(h)));
  const out = alloc(cw, ch);
  for (let r = 0; r < ch; r++) {
    const s = ((y0 + r) * img.width + x0) * 4;
    out.data.set(img.data.subarray(s, s + cw * 4), r * cw * 4);
  }
  return out;
}

/**
 * Apply an EXIF orientation (1–8) so the pixels are upright: 2 mirror,
 * 3 rotate 180, 4 mirror vertically, 5 transpose, 6 rotate 90, 7 transverse,
 * 8 rotate 270.
 */
export function orient(img: Bitmap, orientation: number | undefined): Bitmap {
  switch (orientation) {
    case 2: return flip(img, 'horizontal');
    case 3: return rotate(img, 180);
    case 4: return flip(img, 'vertical');
    case 5: return flip(rotate(img, 90), 'horizontal');
    case 6: return rotate(img, 90);
    case 7: return flip(rotate(img, 90), 'vertical');
    case 8: return rotate(img, 270);
    default: return img;
  }
}

/** Whether an EXIF orientation swaps width and height. */
export function orientationSwaps(orientation: number | undefined): boolean {
  return orientation !== undefined && orientation >= 5 && orientation <= 8;
}

/**
 * One-dimensional resampling weights: area averaging when shrinking (every
 * source pixel contributes by how much of it the output pixel covers), linear
 * interpolation when enlarging.
 */
function weights(src: number, dst: number): Array<{ start: number; w: Float32Array }> {
  const out: Array<{ start: number; w: Float32Array }> = [];
  const scale = src / dst;
  for (let i = 0; i < dst; i++) {
    if (scale >= 1) {
      const a = i * scale;
      const b = Math.min(src, (i + 1) * scale);
      const start = Math.floor(a);
      const end = Math.min(src, Math.ceil(b));
      const w = new Float32Array(end - start);
      for (let k = start; k < end; k++) w[k - start] = Math.min(b, k + 1) - Math.max(a, k);
      out.push({ start, w });
    } else {
      const c = (i + 0.5) * scale - 0.5;
      const k0 = Math.max(0, Math.min(src - 1, Math.floor(c)));
      const k1 = Math.min(src - 1, k0 + 1);
      const t = Math.max(0, Math.min(1, c - k0));
      if (k1 === k0) out.push({ start: k0, w: Float32Array.of(1) });
      else out.push({ start: k0, w: Float32Array.of(1 - t, t) });
    }
  }
  for (const o of out) {
    let s = 0;
    for (const v of o.w) s += v;
    for (let k = 0; k < o.w.length; k++) o.w[k]! /= s || 1;
  }
  return out;
}

/** Resize to exactly width × height (separable: horizontal pass, then vertical). */
export function resize(img: Bitmap, width: number, height: number): Bitmap {
  check(img);
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  if (width === img.width && height === img.height) return { data: new Uint8Array(img.data), width, height };
  const { width: sw, height: sh, data: src } = img;
  const wx = weights(sw, width);
  const tmp = new Float32Array(width * sh * 4);
  for (let y = 0; y < sh; y++) {
    const row = y * sw * 4;
    for (let x = 0; x < width; x++) {
      const { start, w } = wx[x]!;
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < w.length; k++) {
        const si = row + (start + k) * 4;
        const f = w[k]!;
        r += src[si]! * f;
        g += src[si + 1]! * f;
        b += src[si + 2]! * f;
        a += src[si + 3]! * f;
      }
      const ti = (y * width + x) * 4;
      tmp[ti] = r;
      tmp[ti + 1] = g;
      tmp[ti + 2] = b;
      tmp[ti + 3] = a;
    }
  }
  const wy = weights(sh, height);
  const out = alloc(width, height);
  for (let y = 0; y < height; y++) {
    const { start, w } = wy[y]!;
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < w.length; k++) {
        const ti = ((start + k) * width + x) * 4;
        const f = w[k]!;
        r += tmp[ti]! * f;
        g += tmp[ti + 1]! * f;
        b += tmp[ti + 2]! * f;
        a += tmp[ti + 3]! * f;
      }
      const di = (y * width + x) * 4;
      out.data[di] = Math.max(0, Math.min(255, Math.round(r)));
      out.data[di + 1] = Math.max(0, Math.min(255, Math.round(g)));
      out.data[di + 2] = Math.max(0, Math.min(255, Math.round(b)));
      out.data[di + 3] = Math.max(0, Math.min(255, Math.round(a)));
    }
  }
  return out;
}

/**
 * Composite over white and make opaque (for JPEG, which has no transparency;
 * otherwise transparent areas would turn black). `premultiplied`: colour
 * channels already include alpha (platform codec bitmaps); canvas data does not.
 */
export function flattenOnWhite(img: Bitmap, premultiplied: boolean): Bitmap {
  const out = { data: new Uint8Array(img.data), width: img.width, height: img.height };
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]!;
    if (a === 255) continue;
    for (let c = 0; c < 3; c++) {
      const v = premultiplied ? d[i + c]! + (255 - a) : (d[i + c]! * a) / 255 + (255 - a);
      d[i + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
    d[i + 3] = 255;
  }
  return out;
}

/** Whether any pixel is not fully opaque. */
export function hasTransparency(img: Bitmap): boolean {
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] !== 255) return true;
  return false;
}
