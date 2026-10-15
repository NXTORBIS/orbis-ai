import { useMemo, useState } from 'react';
import { Blend } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, CopyBtn, Panel, Stat, ToggleRow } from './shared';

const PHOTO = 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1400&q=80';

const PRESETS = {
  Frosted: { blur: 16, tint: '#ffffff', alpha: 14, border: 30, radius: 20, shadow: 28, saturate: 140, highlight: true },
  Smoke: { blur: 26, tint: '#0b1020', alpha: 26, border: 16, radius: 16, shadow: 38, saturate: 120, highlight: false },
  Neon: { blur: 10, tint: '#22d3ee', alpha: 18, border: 58, radius: 26, shadow: 32, saturate: 175, highlight: true },
  Ocean: { blur: 20, tint: '#0ea5e9', alpha: 20, border: 36, radius: 18, shadow: 26, saturate: 150, highlight: true },
  Sunset: { blur: 14, tint: '#fb7185', alpha: 16, border: 28, radius: 22, shadow: 34, saturate: 150, highlight: true },
  Bare: { blur: 6, tint: '#ffffff', alpha: 6, border: 10, radius: 10, shadow: 12, saturate: 105, highlight: false },
};

const BACKDROPS = [
  { id: 'photo', label: 'Photo' },
  { id: 'mesh', label: 'Mesh' },
  { id: 'grid', label: 'Grid' },
];

const hexToRgb = (hex) => {
  const raw = String(hex).replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const n = parseInt(full || 'ffffff', 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

export default function Glassmorphism() {
  const [preset, setPreset] = useState('Frosted');
  const [cfg, setCfg] = useState({ ...PRESETS.Frosted });
  const [backdrop, setBackdrop] = useState('photo');

  const set = (key, value) => setCfg((c) => ({ ...c, [key]: value }));
  const choose = (name) => { setPreset(name); setCfg({ ...PRESETS[name] }); };

  const { r, g, b } = hexToRgb(cfg.tint);

  const css = useMemo(() => [
    `background: rgba(${r}, ${g}, ${b}, ${(cfg.alpha / 100).toFixed(2)});`,
    `backdrop-filter: blur(${cfg.blur}px) saturate(${cfg.saturate}%);`,
    `-webkit-backdrop-filter: blur(${cfg.blur}px) saturate(${cfg.saturate}%);`,
    `border: 1px solid rgba(255, 255, 255, ${(cfg.border / 100).toFixed(2)});`,
    `border-radius: ${cfg.radius}px;`,
    `box-shadow: 0 ${Math.round(cfg.shadow / 2)}px ${cfg.shadow}px rgba(2, 6, 23, ${(cfg.shadow / 100).toFixed(2)});`,
    cfg.highlight ? '/* add an inner highlight for the glass edge */\ninset 0 1px 0 rgba(255, 255, 255, 0.35);' : '/* no inner highlight */',
  ].join('\n'), [cfg, r, g, b]);

  const cardStyle = {
    background: `rgba(${r}, ${g}, ${b}, ${(cfg.alpha / 100).toFixed(2)})`,
    backdropFilter: `blur(${cfg.blur}px) saturate(${cfg.saturate}%)`,
    WebkitBackdropFilter: `blur(${cfg.blur}px) saturate(${cfg.saturate}%)`,
    border: `1px solid rgba(255, 255, 255, ${(cfg.border / 100).toFixed(2)})`,
    borderRadius: `${cfg.radius}px`,
    boxShadow: `0 ${Math.round(cfg.shadow / 2)}px ${cfg.shadow}px rgba(2, 6, 23, ${(cfg.shadow / 100).toFixed(2)})${cfg.highlight ? ', inset 0 1px 0 rgba(255,255,255,0.35)' : ''}`,
  };

  return (
    <ToolShell
      toolId="glass"
      icon={Blend}
      title="Glassmorphism Generator"
      desc="Frosted glass panels you can see through — tune the blur, tint and edge, then copy the CSS."
      state={{ preset, cfg, backdrop }}
      onRestore={(saved) => {
        if (saved.cfg) setCfg(saved.cfg);
        if (saved.preset) setPreset(saved.preset);
        if (saved.backdrop) setBackdrop(saved.backdrop);
      }}
      exportText={`/* ${preset} glass */\n.glass {\n${css.split('\n').map((l) => `  ${l}`).join('\n')}\n}`}
      exportName="glass.css"
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

      <div className="relative overflow-hidden rounded-2xl border border-border/70">
        {backdrop === 'photo' && <img src={PHOTO} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        {backdrop === 'mesh' && (
          <div className="gradient-drift absolute inset-0" style={{ background: 'linear-gradient(135deg, #22d3ee 0%, #6366f1 45%, #ec4899 100%)' }} />
        )}
        {backdrop === 'grid' && <div className="neural-grid absolute inset-0 bg-background" />}
        <div className="relative flex min-h-52 items-center justify-center p-6">
          <div className="w-full max-w-xs p-4 text-white" style={cardStyle}>
            <div className="text-sm font-semibold">Glass card</div>
            <p className="mt-1 text-[11px] opacity-80">Everything behind stays readable while the surface keeps its depth.</p>
            <div className="mt-3 flex gap-2">
              <span className="rounded-md bg-white/20 px-2 py-1 text-[11px]">Primary</span>
              <span className="rounded-md border border-white/25 px-2 py-1 text-[11px]">Ghost</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-1.5">
        {BACKDROPS.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setBackdrop(b.id)}
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition ${backdrop === b.id ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/50'}`}
          >
            {b.label}
          </button>
        ))}
      </div>

      <Field label={`Backdrop blur · ${cfg.blur}px`}>
        <input type="range" min={0} max={40} value={cfg.blur} onChange={(e) => set('blur', Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Tint · ${cfg.tint.toUpperCase()}`}>
        <div className="flex items-center gap-3">
          <input type="color" value={cfg.tint} onChange={(e) => set('tint', e.target.value)} className="h-9 w-14 cursor-pointer rounded-md border border-input bg-transparent" />
          <input type="range" min={0} max={60} value={cfg.alpha} onChange={(e) => set('alpha', Number(e.target.value))} className="flex-1 accent-[hsl(var(--cyan))]" />
          <span className="w-12 text-right font-mono-j text-[11px] text-muted-foreground">{cfg.alpha}%</span>
        </div>
      </Field>
      <Field label={`Edge light · ${cfg.border}%`}>
        <input type="range" min={0} max={90} value={cfg.border} onChange={(e) => set('border', Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Saturation · ${cfg.saturate}%`}>
        <input type="range" min={80} max={220} value={cfg.saturate} onChange={(e) => set('saturate', Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Corner radius · ${cfg.radius}px`}>
        <input type="range" min={0} max={44} value={cfg.radius} onChange={(e) => set('radius', Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Drop shadow · ${cfg.shadow}px`}>
        <input type="range" min={0} max={60} value={cfg.shadow} onChange={(e) => set('shadow', Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <ToggleRow label="Inner highlight" checked={cfg.highlight} onChange={(v) => set('highlight', v)} hint="catches the light on the top edge" />

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Blur" value={`${cfg.blur}px`} mono />
        <Stat label="Tint alpha" value={`${cfg.alpha}%`} mono />
        <Stat label="Radius" value={`${cfg.radius}px`} mono />
      </div>

      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">CSS</span>
          <CopyBtn value={css} />
        </div>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap font-mono-j text-[11px] scrollbar-thin">{css}</pre>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The blur only samples whatever sits behind the element, so a glass panel over a busy photo reads better than the same panel over flat colour.
          If a browser doesn't support it, the tint colour is what everyone sees.
        </p>
      </Panel>
    </ToolShell>
  );
}