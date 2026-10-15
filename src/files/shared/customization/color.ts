/**
 * Colour parsing, normalisation and WCAG contrast. Every colour that enters
 * the customization engine passes through `parseColor`, which accepts only
 * hex, rgb()/rgba() and hsl()/hsla() and returns a normalised hex string, so
 * nothing but a colour can ever reach a CSS variable.
 */

export interface Rgba { r: number; g: number; b: number; a: number }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 100) / 100;
  l = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function rgbToHsl({ r, g, b }: Rgba): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  h *= 60;
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

const NUM = String.raw`\s*(-?\d+(?:\.\d+)?)\s*`;
const PCT = String.raw`\s*(\d+(?:\.\d+)?)%\s*`;
const ALPHA = String.raw`(?:,\s*(\d*(?:\.\d+)?%?)\s*)?`;

/** Parse a colour string. Returns undefined for anything that is not a plain colour value. */
export function parseRgba(input: string): Rgba | undefined {
  if (typeof input !== 'string' || input.length > 64) return undefined;
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) {
    let h = m[1]!;
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? Math.round((parseInt(h.slice(6, 8), 16) / 255) * 1000) / 1000 : 1 };
  }
  const alpha = (v: string | undefined) => {
    if (v === undefined || v === '') return 1;
    const n = v.endsWith('%') ? Number(v.slice(0, -1)) / 100 : Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : NaN;
  };
  m = new RegExp(`^rgba?\\(${NUM},${NUM},${NUM}${ALPHA}\\)$`).exec(s);
  if (m) {
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const a = alpha(m[4]);
    if ([r, g, b].some((x) => !Number.isInteger(x) || x < 0 || x > 255) || Number.isNaN(a)) return undefined;
    return { r, g, b, a };
  }
  m = new RegExp(`^hsla?\\(${NUM},${PCT},${PCT}${ALPHA}\\)$`).exec(s);
  if (m) {
    const a = alpha(m[4]);
    const [h, sat, l] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (sat > 100 || l > 100 || Number.isNaN(a)) return undefined;
    const [r, g, b] = hslToRgb(h, sat, l);
    return { r, g, b, a };
  }
  return undefined;
}

export function toHex({ r, g, b, a }: Rgba): string {
  const h = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}${a < 1 ? h(a * 255) : ''}`;
}

/** Normalised hex for a valid colour, or undefined. */
export function parseColor(input: string): string | undefined {
  const c = parseRgba(input);
  return c ? toHex(c) : undefined;
}

/** Alpha-composite `top` over an opaque `bottom`. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a;
  return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 };
}

export function luminance({ r, g, b }: Rgba): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 2 contrast ratio between two colours (translucent foregrounds are composited over the background). */
export function contrastRatio(fg: string, bg: string): number {
  const b = parseRgba(bg);
  const f = parseRgba(fg);
  if (!b || !f) return 0;
  const bo = b.a < 1 ? composite(b, { r: 0, g: 0, b: 0, a: 1 }) : b;
  const fo = f.a < 1 ? composite(f, bo) : f;
  const [l1, l2] = [luminance(fo), luminance(bo)].sort((x, y) => y - x) as [number, number];
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}

/**
 * The closest colour to `fg` (same hue and saturation, lightness moved the
 * least) that reaches `min` contrast against every background. Used to offer
 * a safe alternative when a chosen colour is not readable.
 */
export function nearestAccessible(fg: string, backgrounds: string[], min: number): string | undefined {
  const c = parseRgba(fg);
  if (!c) return undefined;
  const ok = (hex: string) => backgrounds.every((bg) => contrastRatio(hex, bg) >= min);
  if (ok(toHex(c))) return toHex(c);
  const { h, s, l } = rgbToHsl(c);
  for (let d = 1; d <= 100; d++) {
    for (const cand of [l + d, l - d]) {
      if (cand < 0 || cand > 100) continue;
      const [r, g, b] = hslToRgb(h, s, cand);
      const hex = toHex({ r, g, b, a: c.a });
      if (ok(hex)) return hex;
    }
  }
  return undefined;
}

export function describeColor(hex: string): { hex: string; rgb: string; hsl: string } | undefined {
  const c = parseRgba(hex);
  if (!c) return undefined;
  const { h, s, l } = rgbToHsl(c);
  return { hex: toHex(c), rgb: c.a < 1 ? `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})` : `rgb(${c.r}, ${c.g}, ${c.b})`, hsl: c.a < 1 ? `hsla(${h}, ${s}%, ${l}%, ${c.a})` : `hsl(${h}, ${s}%, ${l}%)` };
}
