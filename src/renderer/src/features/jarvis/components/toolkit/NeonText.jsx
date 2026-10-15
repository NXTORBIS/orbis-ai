import { useMemo, useState } from 'react';
import { Sparkle } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, CopyBtn, Panel, Stat, ToggleRow } from './shared';

const PRESETS = {
  'Neon cyan': { text: '#f8fdff', glow: '#22d3ee', layers: 3, intensity: 8, bg: 'dark' },
  'Hot pink': { text: '#fff0f9', glow: '#ec4899', layers: 3, intensity: 9, bg: 'dark' },
  'Retro mint': { text: '#f2fff8', glow: '#34d399', layers: 2, intensity: 7, bg: 'dark' },
  Sunset: { text: '#fff7ed', glow: '#fb923c', layers: 3, intensity: 10, bg: 'dark' },
  Ice: { text: '#f0f9ff', glow: '#60a5fa', layers: 2, intensity: 6, bg: 'dark' },
  Gold: { text: '#fffbeb', glow: '#facc15', layers: 3, intensity: 8, bg: 'dark' },
  Ghost: { text: '#e5e7eb', glow: '#64748b', layers: 1, intensity: 4, bg: 'light' },
};

const BACKGROUNDS = {
  dark: { label: 'Dark', value: '#05070d' },
  gradient: { label: 'Gradient', value: 'linear-gradient(135deg, #070b18, #241b3a 58%, #04121a)' },
  light: { label: 'Light', value: '#f8fafc' },
};

export default function NeonText() {
  const [preset, setPreset] = useState('Neon cyan');
  const [cfg, setCfg] = useState({ ...PRESETS['Neon cyan'] });
  const [text, setText] = useState('MARK32');
  const [spacing, setSpacing] = useState(6);
  const [fontSize, setFontSize] = useState(3.6);

  const set = (key, value) => setCfg((c) => ({ ...c, [key]: value }));
  const choose = (name) => { setPreset(name); setCfg({ ...PRESETS[name] }); };

  const shadow = useMemo(() => {
    const parts = [];
    for (let i = 0; i < cfg.layers; i++) {
      const blur = i === 0 ? cfg.intensity * 0.35 : cfg.intensity * (i + 0.7);
      parts.push(`0 0 ${blur.toFixed(1)}px ${cfg.glow}`);
    }
    parts.push(`0 0 ${(cfg.intensity * 4.2).toFixed(1)}px ${cfg.glow}`);
    parts.push(`0 0 ${(cfg.intensity * 8).toFixed(1)}px ${cfg.glow}`);
    return parts.join(', ');
  }, [cfg]);

  const css = `.neon {\n  color: ${cfg.text};\n  font-family: var(--font-display);\n  font-size: ${fontSize}rem;\n  letter-spacing: ${spacing}px;\n  text-shadow: ${shadow};\n}`;
  const backdrop = BACKGROUNDS[cfg.bg];

  return (
    <ToolShell
      toolId="text-shadow"
      icon={Sparkle}
      title="Neon Text Generator"
      desc="Layered glows that actually look lit — stack the shadows, pick a colour and take the CSS."
      state={{ preset, cfg, text, spacing, fontSize }}
      onRestore={(saved) => {
        if (saved.cfg) setCfg(saved.cfg);
        if (saved.preset) setPreset(saved.preset);
        if (saved.text !== undefined) setText(saved.text);
        setSpacing(saved.spacing ?? 6);
        setFontSize(saved.fontSize ?? 3.6);
      }}
      exportText={css}
      exportName="neon.css"
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

      <Panel className="!p-0 overflow-hidden">
        <div className="relative grid min-h-56 place-items-center p-6" style={{ background: backdrop.value }}>
          <div aria-hidden className="tk-aurora" />
          <span
            className="relative break-words text-center font-display font-bold"
            style={{ color: cfg.text, fontSize: `${fontSize}rem`, letterSpacing: `${spacing}px`, textShadow: shadow, lineHeight: 1.15 }}
          >
            {text || 'Type something'}
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-border/70 px-4 py-2">
          <span className="font-mono-j text-[11px] text-muted-foreground">{cfg.layers} glow layers · {cfg.intensity}px core</span>
          <CopyBtn value={css} label="Copy CSS" />
        </div>
      </Panel>

      <Field label="Text">
        <input value={text} onChange={(e) => setText(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Glow colour · ${cfg.glow.toUpperCase()}`}>
          <input type="color" value={cfg.glow} onChange={(e) => set('glow', e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
        <Field label={`Letter colour · ${cfg.text.toUpperCase()}`}>
          <input type="color" value={cfg.text} onChange={(e) => set('text', e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
      </div>

      <Field label={`Glow layers · ${cfg.layers}`}>
        <input type="range" min={1} max={5} value={cfg.layers} onChange={(e) => set('layers', Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Glow spread · ${cfg.intensity}px`}>
        <input type="range" min={2} max={20} value={cfg.intensity} onChange={(e) => set('intensity', Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Size · ${fontSize}rem`}>
        <input type="range" min={1.2} max={7} step={0.1} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Letter spacing · ${spacing}px`}>
        <input type="range" min={0} max={24} value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <Field label="Background">
        <Seg value={cfg.bg} onChange={(v) => set('bg', v)} options={Object.entries(BACKGROUNDS).map(([id, b]) => ({ value: id, label: b.label }))} />
      </Field>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Layers" value={String(cfg.layers + 2)} mono />
        <Stat label="Spread" value={`${cfg.intensity}px`} mono />
        <Stat label="Backdrop" value={backdrop.label} />
      </div>

      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">CSS</span>
          <CopyBtn value={`/* add a class of "neon" to any heading */`} label="Copy note" />
        </div>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap font-mono-j text-[11px] scrollbar-thin">{css}</pre>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Glow is just the same colour blurred repeatedly — the shortest blur sharpens the tube, the longest ones spill light into the room.
          It only reads as neon on a dark or very saturated backdrop, so keep the surface behind it dark.
        </p>
      </Panel>
    </ToolShell>
  );
}