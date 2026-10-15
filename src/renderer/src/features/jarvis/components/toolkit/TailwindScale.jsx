import { useMemo, useState } from 'react';
import { Palette } from 'lucide-react';
import { ToolHeader, Field, Out, CopyBtn, Panel, Stat } from './shared';
import ToolShell from './kit/ToolShell';

const LIGHTEN = [[50, 0.92], [100, 0.82], [200, 0.66], [300, 0.44], [400, 0.22]];
const DARKEN = [[600, 0.14], [700, 0.3], [800, 0.45], [900, 0.58], [950, 0.72]];

const hexToRgb = (hex) => {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const int = parseInt(full.slice(0, 6), 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
};

const rgbToHex = ({ r, g, b }) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

const rgbToHsl = ({ r, g, b }) => {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0; let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
};

const hslToRgb = ({ h, s, l }) => {
  const sn = s / 100; const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = ln - c / 2;
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
};

const luminance = ({ r, g, b }) => {
  const channel = (v) => { const n = v / 255; return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

export default function TailwindScale() {
  const [base, setBase] = useState('#22d3ee');
  const [name, setName] = useState('brand');

  const scale = useMemo(() => {
    const rgb = hexToRgb(base);
    const hsl = rgbToHsl(rgb);
    const build = (stop) => {
      const lighten = LIGHTEN.find(([s]) => s === stop);
      const darken = DARKEN.find(([s]) => s === stop);
      let derived = hsl;
      if (lighten) derived = { h: hsl.h, s: hsl.s * (stop <= 100 ? 0.9 : 0.96), l: hsl.l + (100 - hsl.l) * lighten[1] };
      if (darken) derived = { h: hsl.h, s: hsl.s * (stop >= 900 ? 0.85 : 0.95), l: Math.max(4, hsl.l * (1 - darken[1])) };
      const value = rgbToHex(hslToRgb(derived));
      const contrast = luminance(hexToRgb(value)) > 0.42 ? '#0b1220' : '#ffffff';
      return { stop, hex: value, contrast };
    };
    return [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((stop) => ({ ...build(stop), base: stop === 500 }));
  }, [base]);

  const css = `:root {\n${scale.map((s) => `  --color-${name}-${s.stop}: ${s.hex};`).join('\n')}\n}`;

  const tailwind = `// tailwind.config.js\ntheme: {\n  extend: {\n    colors: {\n      ${name}: {\n${scale.map((s) => `        ${s.stop}: '${s.hex}',`).join('\n')}\n      },\n    },\n  },\n},`;

  return (
    <ToolShell
      toolId="colour-scale"
      icon={Palette}
      title="Colour Scale Generator"
      desc="One base colour becomes a full 50–950 scale, with CSS variables and a Tailwind config ready to paste."
      state={{ base, name }}
      onRestore={(saved) => { setBase(saved.base); setName(saved.name); }}
      exportText={css}
      exportName="colour-scale.css"
      exportMime="text/css"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Base colour (becomes the 500 step)">
          <div className="flex gap-2">
            <input type="color" value={base} onChange={(e) => setBase(e.target.value)} className="h-9 w-12 rounded-md border border-input bg-transparent" />
            <input value={base} onChange={(e) => setBase(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
          </div>
        </Field>
        <Field label="Colour name used in the output">
          <input value={name} onChange={(e) => setName(e.target.value.replace(/[^a-z0-9-]/gi, '').toLowerCase())} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {scale.map((step) => (
          <button
            key={step.stop}
            onClick={() => navigator.clipboard?.writeText(step.hex)}
            className={`flex items-end justify-between rounded-xl border px-3 py-4 text-left transition ${step.base ? 'border-cyan-j/70 ring-1 ring-cyan-j/40' : 'border-border/70'}`}
            style={{ background: step.hex, color: step.contrast }}
            title={`Copy ${step.hex}`}
          >
            <span className="text-sm font-semibold">{step.stop}</span>
            <span className="font-mono-j text-[10px] opacity-80">{step.hex}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Base (500)" value={scale[4].hex} mono />
        <Stat label="Lightest (50)" value={scale[0].hex} mono />
        <Stat label="Darkest (950)" value={scale[10].hex} mono />
      </div>
      <div className="space-y-2">
        <Out label="CSS variables" value={css}>
          <pre className="font-mono-j text-[11px] text-cyan-j">{css}</pre>
        </Out>
        <Out label="tailwind.config.js" value={tailwind}>
          <pre className="max-h-64 overflow-auto font-mono-j text-[11px] text-cyan-j scrollbar-thin">{tailwind}</pre>
        </Out>
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyBtn value={css} label="Copy CSS" />
        <CopyBtn value={tailwind} label="Copy Tailwind config" />
        <CopyBtn value={scale.map((s) => s.hex).join('\n')} label="Copy hex list" />
      </div>
      <Panel>
        <div className="text-[11px] leading-relaxed text-muted-foreground">
          Lighter steps mix the base towards white and darker steps towards black, keeping your hue so the scale stays on-brand. Every swatch is labelled in whichever of white or near-black reads better against it — click one to copy its hex.
        </div>
      </Panel>
    </ToolShell>
  );
}