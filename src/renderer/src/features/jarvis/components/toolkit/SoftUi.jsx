import { useMemo, useState } from 'react';
import { Square } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, CopyBtn, Panel, Stat, ToggleRow } from './shared';

const PRESETS = {
  Classic: { base: '#e0e5ec', distance: 12, blur: 24, strength: 55, radius: 26, size: 132, inset: false },
  Paper: { base: '#f4f1ea', distance: 8, blur: 18, strength: 42, radius: 14, size: 128, inset: false },
  Deep: { base: '#d4d9e2', distance: 18, blur: 34, strength: 70, radius: 30, size: 140, inset: false },
  Dark: { base: '#232833', distance: 12, blur: 26, strength: 80, radius: 22, size: 132, inset: false },
  Neon: { base: '#101827', distance: 10, blur: 22, strength: 90, radius: 24, size: 136, inset: true },
  Pressed: { base: '#e0e5ec', distance: 8, blur: 16, strength: 55, radius: 20, size: 132, inset: true },
};

const hexToRgb = (hex) => {
  const raw = String(hex).replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const n = parseInt(full || 'e0e5ec', 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

const shift = (hex, amount) => {
  const { r, g, b } = hexToRgb(hex);
  const move = (c) => Math.max(0, Math.min(255, Math.round(c + amount * 255)));
  return `${move(r)}, ${move(g)}, ${move(b)}`;
};

export default function SoftUi() {
  const [preset, setPreset] = useState('Classic');
  const [cfg, setCfg] = useState({ ...PRESETS.Classic });

  const set = (key, value) => setCfg((c) => ({ ...c, [key]: value }));
  const choose = (name) => { setPreset(name); setCfg({ ...PRESETS[name] }); };

  const shadow = useMemo(() => {
    const alpha = (cfg.strength / 100).toFixed(2);
    const light = `rgba(255, 255, 255, ${(cfg.strength / 100).toFixed(2)})`;
    const dark = `rgba(${shift(cfg.base, -0.22)}, ${alpha})`;
    if (cfg.inset) return `inset ${cfg.distance}px ${cfg.distance}px ${cfg.blur}px ${dark}, inset -${cfg.distance}px -${cfg.distance}px ${cfg.blur}px ${light}`;
    return `${cfg.distance}px ${cfg.distance}px ${cfg.blur}px ${dark}, -${cfg.distance}px -${cfg.distance}px ${cfg.blur}px ${light}`;
  }, [cfg]);

  const css = `background: ${cfg.base};\nborder-radius: ${cfg.radius}px;\nbox-shadow: ${shadow};`;

  return (
    <ToolShell
      toolId="neumorph"
      icon={Square}
      title="Soft UI Generator"
      desc="Neumorphic surfaces that look pressed out of the page — dial the light and copy the CSS."
      state={{ preset, cfg }}
      onRestore={(saved) => {
        if (saved.cfg) setCfg(saved.cfg);
        if (saved.preset) setPreset(saved.preset);
      }}
      exportText={`.soft {\n${css.split('\n').map((l) => `  ${l}`).join('\n')}\n}`}
      exportName="soft-ui.css"
      exportMime="text/css"
    >
      <div className="flex flex-wrap gap-1.5">
        {Object.keys(PRESETS).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => choose(name)}
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition ${preset === name ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j tk-glow-ring' : 'border-border/70 text-muted-foreground hover:border-cyan-j/50'}`}
          >
            {name}
          </button>
        ))}
      </div>

      <Panel className="!p-6" >
        <div className="flex flex-col items-center gap-5 rounded-2xl p-6 transition-colors" style={{ background: cfg.base }}>
          <div
            className="grid place-items-center text-xs font-medium transition-all"
            style={{
              width: `${cfg.size}px`,
              height: `${cfg.size}px`,
              borderRadius: `${cfg.radius}px`,
              background: cfg.base,
              boxShadow: cfg.inset ? shadow.replace(/inset/g, '') : shadow,
              color: hexToRgb(cfg.base).r + hexToRgb(cfg.base).g + hexToRgb(cfg.base).b > 380 ? '#64748b' : '#cbd5e1',
            }}
          >
            Raised
          </div>
          <div
            className="grid place-items-center text-xs font-medium"
            style={{
              width: `${cfg.size - 24}px`,
              height: `${Math.round(cfg.size / 2.6)}px`,
              borderRadius: `${cfg.radius}px`,
              background: cfg.base,
              boxShadow: `inset ${cfg.distance}px ${cfg.distance}px ${cfg.blur}px rgba(${shift(cfg.base, -0.22)}, ${(cfg.strength / 100).toFixed(2)}), inset -${cfg.distance}px -${cfg.distance}px ${cfg.blur}px rgba(255,255,255,${(cfg.strength / 100).toFixed(2)})`,
              color: hexToRgb(cfg.base).r + hexToRgb(cfg.base).g + hexToRgb(cfg.base).b > 380 ? '#64748b' : '#cbd5e1',
            }}
          >
            Pressed
          </div>
        </div>
      </Panel>

      <Field label={`Base colour · ${cfg.base.toUpperCase()}`}>
        <div className="flex items-center gap-3">
          <input type="color" value={cfg.base} onChange={(e) => set('base', e.target.value)} className="h-9 w-14 cursor-pointer rounded-md border border-input bg-transparent" />
          <input type="range" min={0} max={100} value={cfg.strength} onChange={(e) => set('strength', Number(e.target.value))} className="flex-1 accent-[hsl(var(--cyan))]" />
          <span className="w-12 text-right font-mono-j text-[11px] text-muted-foreground">{cfg.strength}%</span>
        </div>
      </Field>
      <Field label={`Distance · ${cfg.distance}px`}>
        <input type="range" min={2} max={30} value={cfg.distance} onChange={(e) => set('distance', Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Blur · ${cfg.blur}px`}>
        <input type="range" min={4} max={60} value={cfg.blur} onChange={(e) => set('blur', Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Radius · ${cfg.radius}px`}>
        <input type="range" min={0} max={60} value={cfg.radius} onChange={(e) => set('radius', Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Element size · ${cfg.size}px`}>
        <input type="range" min={72} max={220} value={cfg.size} onChange={(e) => set('size', Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <ToggleRow label="Pressed (inset)" checked={cfg.inset} onChange={(v) => set('inset', v)} hint="carved in, not raised" />

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Distance" value={`${cfg.distance}px`} mono />
        <Stat label="Blur" value={`${cfg.blur}px`} mono />
        <Stat label="Contrast" value={`${cfg.strength}%`} mono />
      </div>

      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">CSS</span>
          <CopyBtn value={css} />
        </div>
        <pre className="max-h-52 overflow-auto whitespace-pre-wrap font-mono-j text-[11px] scrollbar-thin">{css}</pre>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Soft UI leans on two shadows: one dark below-right, one light above-left. Keep the surface flat and the contrast low, and use the pressed
          version for inputs, toggles and anything the user "pushes".
        </p>
      </Panel>
    </ToolShell>
  );
}