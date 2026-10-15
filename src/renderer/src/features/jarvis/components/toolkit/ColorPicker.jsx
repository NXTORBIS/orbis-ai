import { useEffect, useRef, useState } from 'react';
import { Pipette } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, CopyBtn, Field, Stat, Unsupported } from './shared';

function hexToRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
function rgbToHex(r, g, b) { return '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join(''); }
function rgbToHsl(r, g, b) { r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b), min = Math.min(r, g, b); let h, s, l = (max + min) / 2; if (max === min) { h = s = 0; } else { const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min); switch (max) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; default: h = (r - g) / d + 4; } h /= 6; } return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }; }
function rgbToHsv(r, g, b) { r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; let h, s = max === 0 ? 0 : d / max, v = max; if (d === 0) h = 0; else switch (max) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; default: h = (r - g) / d + 4; } h /= 6; return { h: Math.round(h * 360), s: Math.round(s * 100), v: Math.round(v * 100) }; }
function rgbToCmyk(r, g, b) { r /= 255; g /= 255; b /= 255; const k = 1 - Math.max(r, g, b); if (k === 1) return { c: 0, m: 0, y: 0, k: 100 }; return { c: Math.round(((1 - r - k) / (1 - k)) * 100), m: Math.round(((1 - g - k) / (1 - k)) * 100), y: Math.round(((1 - b - k) / (1 - k)) * 100), k: Math.round(k * 100) }; }

export default function ColorPicker() {
  const [color, setColor] = useState('#00b4d8');
  const [history, setHistory] = useState([]);
  const [eyedropper, setEyedropper] = useState('idle');
  const rgb = hexToRgb(color);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const cmyk = rgbToCmyk(rgb.r, rgb.g, rgb.b);

  const pick = async () => {
    if (!window.EyeDropper) { setEyedropper('unsupported'); return; }
    try {
      setEyedropper('active');
      const ed = new window.EyeDropper();
      const res = await ed.open();
      setColor(res.sRGBHex);
      setHistory((h) => [res.sRGBHex, ...h.filter((c) => c !== res.sRGBHex)].slice(0, 12));
    } catch { /* cancelled */ }
    finally { setEyedropper('idle'); }
  };

  const onManual = (e) => setColor(e.target.value);

  return (
    <div className="space-y-4">
      <ToolHeader icon={Pipette} title="Color Picker" desc="Pick colors, convert between formats, and keep a history. Uses the native EyeDropper where supported." />
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-16 w-16 shrink-0 rounded-xl border border-border" style={{ background: color }} />
        <Field label="Pick color">
          <input type="color" value={color} onChange={onManual} className="h-9 w-16 cursor-pointer rounded-md border border-input bg-transparent p-0.5" />
        </Field>
        <Button size="sm" variant="outline" onClick={pick} disabled={eyedropper === 'active'} className="gap-1.5">
          <Pipette className="h-4 w-4" /> {eyedropper === 'active' ? 'Picking…' : 'Eyedropper'}
        </Button>
        {eyedropper === 'unsupported' && <Unsupported msg="EyeDropper API is not supported in this browser. Use the color input above instead." />}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          ['HEX', color.toUpperCase()],
          ['RGB', `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`],
          ['HSL', `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`],
          ['HSV', `${hsv.h}°, ${hsv.s}%, ${hsv.v}%`],
          ['CMYK', `${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%`],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between rounded-lg border border-border/70 bg-card/60 px-3 py-2">
            <div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div><div className="font-mono-j text-sm">{v}</div></div>
            <CopyBtn value={v} />
          </div>
        ))}
      </div>
      {history.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">History</div>
          <div className="flex flex-wrap gap-1.5">
            {history.map((c) => (
              <button key={c} onClick={() => setColor(c)} title={c} className="h-7 w-7 rounded-md border border-border transition hover:scale-110" style={{ background: c }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}