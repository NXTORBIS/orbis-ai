import { useState } from 'react';
import { Palette } from 'lucide-react';
import { ToolHeader, Field, Out } from './shared';

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const hex2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');

export function hexToRgb(hex) {
  const s = hex.trim().replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
}

export const rgbToHex = ({ r, g, b }) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

export function rgbToHsl({ r, g, b }) {
  const rr = r / 255; const gg = g / 255; const bb = b / 255;
  const max = Math.max(rr, gg, bb); const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  let h = 0; let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb({ h, s, l }) {
  const hh = (((h % 360) + 360) % 360) / 360; const ss = clamp(s, 0, 100) / 100; const ll = clamp(l, 0, 100) / 100;
  if (ss === 0) { const v = ll * 255; return { r: v, g: v, b: v }; }
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const hue = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return { r: hue(hh + 1 / 3) * 255, g: hue(hh) * 255, b: hue(hh - 1 / 3) * 255 };
}

export default function ColorConverter() {
  const [hex, setHex] = useState('#22d3ee');
  const [rgbText, setRgbText] = useState('');
  const [hslText, setHslText] = useState('');

  const rgb = hexToRgb(hex);
  const hsl = rgb ? rgbToHsl(rgb) : null;
  const rgbString = rgb ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : '';
  const hslString = hsl ? `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` : '';

  const commitRgb = (text) => {
    setRgbText(text);
    const m = text.match(/(\d{1,3})\D+(\d{1,3})\D+(\d{1,3})/);
    if (m) setHex(rgbToHex({ r: +m[1], g: +m[2], b: +m[3] }));
  };

  const commitHsl = (text) => {
    setHslText(text);
    const m = text.match(/(-?\d{1,3})\D+(\d{1,3})\D+(\d{1,3})/);
    if (m) setHex(rgbToHex(hslToRgb({ h: +m[1], s: +m[2], l: +m[3] })));
  };

  const strip = hsl
    ? Array.from({ length: 9 }, (_, i) => rgbToHex(hslToRgb({ h: hsl.h, s: hsl.s, l: clamp(10 + i * 10, 0, 100) })))
    : [];

  return (
    <div className="space-y-4">
      <ToolHeader icon={Palette} title="Color Converter" desc="HEX, RGB and HSL side by side — with a tint and shade strip." />
      <div className="flex items-center gap-3">
        <input type="color" value={rgb ? rgbToHex(rgb) : '#000000'} onChange={(e) => setHex(e.target.value)} className="h-14 w-14 cursor-pointer rounded-xl border border-border/70 bg-transparent" />
        <Field label="HEX">
          <input value={hex} onChange={(e) => setHex(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j uppercase text-sm" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="RGB">
          <input value={rgbText || rgbString} onChange={(e) => commitRgb(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="HSL">
          <input value={hslText || hslString} onChange={(e) => commitHsl(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      </div>
      {rgb ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <Out label="HEX" value={rgbToHex(rgb)}>{rgbToHex(rgb).toUpperCase()}</Out>
            <Out label="RGB" value={rgbString}>{rgbString}</Out>
            <Out label="HSL" value={hslString}>{hslString}</Out>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Tints & shades</div>
            <div className="flex overflow-hidden rounded-xl border border-border/70">
              {strip.map((c) => (
                <button key={c} onClick={() => setHex(c)} title={c} style={{ background: c }} className="h-12 flex-1 transition hover:scale-y-110" />
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">Enter a 3 or 6 digit hex colour.</div>
      )}
    </div>
  );
}