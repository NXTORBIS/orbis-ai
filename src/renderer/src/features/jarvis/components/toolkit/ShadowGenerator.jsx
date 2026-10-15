import { useState } from 'react';
import { Square } from 'lucide-react';
import { ToolHeader, Field, CopyBtn, ToggleRow, Panel } from './shared';

const PRESETS = [
  ['Soft', { x: 0, y: 4, blur: 14, spread: -4, opacity: 18, color: '#0f172a', inset: false }],
  ['Lifted', { x: 0, y: 10, blur: 30, spread: -8, opacity: 28, color: '#0f172a', inset: false }],
  ['Neon', { x: 0, y: 0, blur: 20, spread: 0, opacity: 60, color: '#22d3ee', inset: false }],
  ['Pressed', { x: 0, y: 2, blur: 6, spread: 0, opacity: 30, color: '#0f172a', inset: true }],
];

const hexToRgba = (hex, opacity) => {
  const s = hex.replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  const int = parseInt(full, 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${(opacity / 100).toFixed(2)})`;
};

export default function ShadowGenerator() {
  const [s, setS] = useState({ x: 0, y: 10, blur: 30, spread: -8, opacity: 28, color: '#0f172a', inset: false });
  const set = (patch) => setS((cur) => ({ ...cur, ...patch }));
  const value = `${s.inset ? 'inset ' : ''}${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${hexToRgba(s.color, s.opacity)}`;
  const sliders = [['x', 'X offset', -40, 40], ['y', 'Y offset', -40, 40], ['blur', 'Blur', 0, 80], ['spread', 'Spread', -30, 30], ['opacity', 'Opacity %', 0, 100]];

  return (
    <div className="space-y-4">
      <ToolHeader icon={Square} title="Box Shadow Generator" desc="Build layered depth or neon glow — then copy the CSS." />
      <div className="grid place-items-center rounded-2xl border border-border/70 bg-secondary/40 py-12">
        <div className="grid h-28 w-44 place-items-center rounded-xl bg-card text-xs text-muted-foreground" style={{ boxShadow: value }}>preview</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {sliders.map(([key, label, min, max]) => (
          <Field key={key} label={`${label} · ${s[key]}`}>
            <input type="range" min={min} max={max} value={s[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} className="w-full accent-[hsl(var(--cyan))]" />
          </Field>
        ))}
        <Field label="Shadow colour">
          <input type="color" value={s.color} onChange={(e) => set({ color: e.target.value })} className="h-9 w-full cursor-pointer rounded-lg border border-border/70 bg-transparent" />
        </Field>
        <ToggleRow label="Inset shadow" checked={s.inset} onChange={(v) => set({ inset: v })} />
      </div>
      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">CSS</span>
          <CopyBtn value={`box-shadow: ${value};`} />
        </div>
        <pre className="overflow-x-auto font-mono-j text-xs text-cyan-j">{`box-shadow: ${value};`}</pre>
      </Panel>
      <Panel>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Ready-to-use presets</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PRESETS.map(([label, preset]) => (
            <button key={label} onClick={() => setS(preset)} className="rounded-lg border border-border/70 px-2 py-2 text-[11px] transition hover:border-cyan-j/50">
              <div className="mx-auto mb-1.5 h-6 w-10 rounded bg-card" style={{ boxShadow: `${preset.inset ? 'inset ' : ''}${preset.x}px ${preset.y}px ${preset.blur}px ${preset.spread}px ${hexToRgba(preset.color, preset.opacity)}` }} />
              {label}
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}