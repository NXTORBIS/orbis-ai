import { z } from 'zod';

/**
 * Color palette extraction: shared types for the IPC boundary.
 */

export const ExtractedColorSchema = z.object({
  hex: z.string(),
  rgb: z.object({ r: z.number(), g: z.number(), b: z.number() }),
  hsl: z.object({ h: z.number(), s: z.number(), l: z.number() }),
  /** Share of pixels this colour cluster represents (0-1). */
  weight: z.number(),
});
export type ExtractedColor = z.infer<typeof ExtractedColorSchema>;

export interface ColorPalette {
  colors: ExtractedColor[];
  imagePath: string;
  width: number;
  height: number;
}

export type HarmonyKind = 'complementary' | 'analogous' | 'triadic' | 'split-complementary';

export interface HarmonySuggestion {
  kind: HarmonyKind;
  label: string;
  colors: string[]; // hex values
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * Math.max(0, Math.min(1, c)));
  };
  return rgbToHex(f(0), f(8), f(4));
}

export function computeHarmonies(baseHex: string): HarmonySuggestion[] {
  const { r, g, b } = hexToRgb(baseHex);
  const { h, s, l } = rgbToHsl(r, g, b);

  return [
    { kind: 'complementary', label: 'Complementary', colors: [baseHex, hslToHex((h + 180) % 360, s, l)] },
    { kind: 'analogous', label: 'Analogous', colors: [hslToHex((h + 330) % 360, s, l), baseHex, hslToHex((h + 30) % 360, s, l)] },
    { kind: 'triadic', label: 'Triadic', colors: [baseHex, hslToHex((h + 120) % 360, s, l), hslToHex((h + 240) % 360, s, l)] },
    { kind: 'split-complementary', label: 'Split-complementary', colors: [baseHex, hslToHex((h + 150) % 360, s, l), hslToHex((h + 210) % 360, s, l)] },
  ];
}
