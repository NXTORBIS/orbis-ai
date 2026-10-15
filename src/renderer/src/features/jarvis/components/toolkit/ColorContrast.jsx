import { useState } from 'react';
import { Contrast } from 'lucide-react';
import { Input } from '@jarvis/components/ui/input';
import { ToolHeader, Field, Stat } from './shared';

function hexToRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function lum([r, g, b]) { const a = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; }

export default function ColorContrast() {
  const [fg, setFg] = useState('#000000');
  const [bg, setBg] = useState('#ffffff');
  const l1 = lum(hexToRgb(fg)), l2 = lum(hexToRgb(bg));
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  const r = ratio;
  const aa = r >= 4.5, aaLarge = r >= 3, aaa = r >= 7, aaaLarge = r >= 4.5;
  const Badge = ({ ok, label }) => <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${ok ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-red-500/15 text-red-600 dark:text-red-400'}`}>{ok ? 'PASS' : 'FAIL'} {label}</span>;

  return (
    <div className="space-y-4">
      <ToolHeader icon={Contrast} title="Color Contrast Checker" desc="WCAG contrast ratio between foreground and background colors." />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Foreground"><div className="flex items-center gap-2"><input type="color" value={fg} onChange={(e) => setFg(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-input bg-transparent p-0.5" /><Input value={fg} onChange={(e) => setFg(e.target.value)} className="w-28" /></div></Field>
        <Field label="Background"><div className="flex items-center gap-2"><input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-input bg-transparent p-0.5" /><Input value={bg} onChange={(e) => setBg(e.target.value)} className="w-28" /></div></Field>
      </div>
      <div className="rounded-xl border border-border p-6" style={{ background: bg, color: fg }}>
        <div className="text-2xl font-bold">The quick brown fox jumps over the lazy dog</div>
        <div className="mt-1 text-sm">Small text sample — 1234567890</div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Contrast ratio" value={`${r.toFixed(2)}:1`} mono />
        <div className="rounded-lg border border-border/70 bg-card/60 px-3 py-2"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Normal text</div><div className="mt-1 flex gap-1"><Badge ok={aa} label="AA" /><Badge ok={aaa} label="AAA" /></div></div>
        <div className="rounded-lg border border-border/70 bg-card/60 px-3 py-2"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Large text</div><div className="mt-1 flex gap-1"><Badge ok={aaLarge} label="AA" /><Badge ok={aaaLarge} label="AAA" /></div></div>
        <div className="rounded-lg border border-border/70 bg-card/60 px-3 py-2"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">UI components</div><div className="mt-1"><Badge ok={r >= 3} label="AA" /></div></div>
      </div>
    </div>
  );
}