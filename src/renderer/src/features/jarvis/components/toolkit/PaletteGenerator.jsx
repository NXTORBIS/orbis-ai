import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { ToolHeader, Field, CopyBtn, Panel } from './shared';
import { hexToRgb, rgbToHex, rgbToHsl, hslToRgb } from './ColorConverter';

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

function harmony(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const hsl = rgbToHsl(rgb);
  const rotate = (d) => rgbToHex(hslToRgb({ h: hsl.h + d, s: hsl.s, l: hsl.l }));
  const lighten = (l) => rgbToHex(hslToRgb({ h: hsl.h, s: hsl.s, l: clamp(l, 0, 100) }));
  return {
    scale: Array.from({ length: 10 }, (_, i) => lighten(6 + i * 10)),
    complementary: [hsl ? rotate(180) : hex],
    analogous: [rotate(-30), rotate(30)],
    triadic: [rotate(120), rotate(240)],
    split: [rotate(150), rotate(210)],
    neutral: [lighten(92), lighten(20)],
  };
}

export default function PaletteGenerator() {
  const [base, setBase] = useState('#22d3ee');
  const [seed, setSeed] = useState(0);
  const rgb = hexToRgb(base);
  const groups = rgb ? harmony(base) : null;

  const randomize = () => {
    const h = Math.floor(Math.random() * 360);
    setBase(rgbToHex(hslToRgb({ h, s: 60 + Math.floor(Math.random() * 30), l: 50 })));
    setSeed((s) => s + 1);
  };

  const rows = groups ? [
    ['Scale (light → dark)', groups.scale],
    ['Complementary', groups.complementary],
    ['Analogous', groups.analogous],
    ['Triadic', groups.triadic],
    ['Split complementary', groups.split],
    ['Neutral pairing', groups.neutral],
  ] : [];

  return (
    <div className="space-y-4">
      <ToolHeader icon={Sparkles} title="Colour Palette Generator" desc="Build harmonious palettes from one base colour — tints, complements and triads." />
      <div className="flex items-center gap-3">
        <input type="color" value={rgb ? rgbToHex(rgb) : '#000000'} onChange={(e) => setBase(e.target.value)} className="h-12 w-12 cursor-pointer rounded-xl border border-border/70 bg-transparent" />
        <Field label="Base colour">
          <input value={base} onChange={(e) => setBase(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j uppercase text-sm" />
        </Field>
        <button onClick={randomize} className="rounded-lg border border-border/70 px-3 py-2 text-xs text-muted-foreground transition hover:border-cyan-j/50 hover:text-foreground">Surprise me</button>
      </div>
      {groups ? (
        <>
          {rows.map(([label, colors]) => (
            <Panel key={label}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{label}</span>
                <CopyBtn value={colors.join(', ')} label="Copy hexes" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {colors.map((c, i) => (
                  <div key={`${c}-${i}`} className="group w-16">
                    <div className="h-14 rounded-lg border border-border/40 transition group-hover:scale-105" style={{ background: c }} />
                    <div className="mt-1 truncate text-center font-mono-j text-[10px] text-muted-foreground">{c.toUpperCase()}</div>
                  </div>
                ))}
              </div>
            </Panel>
          ))}
          <CopyBtn value={rows.map(([l, c]) => `${l}: ${c.join(', ')}`).join('\n')} label="Copy whole palette" />
        </>
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">Enter a valid hex colour.</div>
      )}
    </div>
  );
}