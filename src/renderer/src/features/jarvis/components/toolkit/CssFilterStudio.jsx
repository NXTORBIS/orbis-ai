import { useMemo, useState } from 'react';
import { WandSparkles } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, CopyBtn, Panel, Stat } from './shared';

const DEFAULTS = { blur: 0, brightness: 100, contrast: 100, grayscale: 0, hue: 0, invert: 0, opacity: 100, saturate: 100, sepia: 0 };

const SLIDERS = [
  { key: 'blur', label: 'Blur', min: 0, max: 20, step: 0.1, unit: 'px' },
  { key: 'brightness', label: 'Brightness', min: 0, max: 200, unit: '%' },
  { key: 'contrast', label: 'Contrast', min: 0, max: 200, unit: '%' },
  { key: 'saturate', label: 'Saturation', min: 0, max: 300, unit: '%' },
  { key: 'grayscale', label: 'Grayscale', min: 0, max: 100, unit: '%' },
  { key: 'sepia', label: 'Sepia', min: 0, max: 100, unit: '%' },
  { key: 'hue', label: 'Hue rotate', min: -180, max: 180, unit: 'deg' },
  { key: 'invert', label: 'Invert', min: 0, max: 100, unit: '%' },
  { key: 'opacity', label: 'Opacity', min: 0, max: 100, unit: '%' },
];

const PRESETS = {
  None: { ...DEFAULTS },
  Soft: { blur: 1.5, brightness: 106, contrast: 96, saturate: 108, sepia: 4, grayscale: 0, hue: 0, invert: 0, opacity: 100 },
  Vintage: { blur: 0, brightness: 104, contrast: 88, saturate: 72, sepia: 34, grayscale: 0, hue: -8, invert: 0, opacity: 100 },
  Drama: { blur: 0, brightness: 96, contrast: 142, saturate: 118, sepia: 0, grayscale: 0, hue: 0, invert: 0, opacity: 100 },
  Noir: { blur: 0.4, brightness: 100, contrast: 128, saturate: 0, sepia: 0, grayscale: 100, hue: 0, invert: 0, opacity: 100 },
  Punchy: { blur: 0, brightness: 104, contrast: 116, saturate: 165, sepia: 0, grayscale: 0, hue: 4, invert: 0, opacity: 100 },
  Dreamy: { blur: 2.4, brightness: 112, contrast: 92, saturate: 118, sepia: 8, grayscale: 0, hue: 12, invert: 0, opacity: 100 },
  Faded: { blur: 0, brightness: 108, contrast: 78, saturate: 82, sepia: 14, grayscale: 6, hue: 0, invert: 0, opacity: 100 },
};

const PHOTO = 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&q=80';

export default function CssFilterStudio() {
  const [filter, setFilter] = useState({ ...DEFAULTS });
  const [preset, setPreset] = useState('None');

  const set = (key, value) => {
    setFilter((current) => ({ ...current, [key]: value }));
    setPreset('Custom');
  };

  const css = useMemo(() => {
    const parts = SLIDERS.filter((s) => filter[s.key] !== DEFAULTS[s.key]).map((s) => {
      const unit = s.unit || '%';
      const name = s.key === 'hue' ? 'hue-rotate' : s.key;
      return `${name}(${filter[s.key]}${unit})`;
    });
    return parts.length ? parts.join(' ') : 'none';
  }, [filter]);

  const changed = SLIDERS.filter((s) => filter[s.key] !== DEFAULTS[s.key]).length;

  return (
    <ToolShell
      toolId="css-filter"
      icon={WandSparkles}
      title="CSS Filter Studio"
      desc="Dial in blur, contrast, hue and the rest, watch them land on a photo and on real UI, then copy the CSS."
      state={{ filter }}
      onRestore={(saved) => { if (saved.filter) setFilter({ ...DEFAULTS, ...saved.filter }); }}
      exportText={`filter: ${css};`}
      exportName="filter.css"
      exportMime="text/css"
    >
      <div className="flex flex-wrap gap-1.5">
        {Object.keys(PRESETS).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => { setPreset(name); setFilter({ ...DEFAULTS, ...PRESETS[name] }); }}
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition ${preset === name ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/50'}`}
          >
            {name}
          </button>
        ))}
      </div>

      <Panel className="p-3">
        <img src={PHOTO} alt="Filter preview" className="h-44 w-full rounded-lg object-cover transition-[filter] duration-200" style={{ filter: css }} />
        <div className="mt-3 rounded-lg border border-border/70 bg-background/60 p-3 transition-[filter] duration-200" style={{ filter: css }}>
          <div className="text-sm font-semibold">Sample card</div>
          <p className="mt-1 text-[11px] text-muted-foreground">The same filter on real interface text, so you can judge readability.</p>
          <div className="mt-2 flex gap-2">
            <span className="rounded-md bg-cyan-j/20 px-2 py-1 text-[11px] text-cyan-j">Badge</span>
            <span className="rounded-md border border-border/70 px-2 py-1 text-[11px] text-muted-foreground">Button</span>
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        {SLIDERS.map((s) => (
          <Field key={s.key} label={`${s.label} · ${filter[s.key]}${s.unit || '%'}`}>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step || 1}
              value={filter[s.key]}
              onChange={(e) => set(s.key, Number(e.target.value))}
              className="w-full accent-[hsl(var(--cyan))]"
            />
          </Field>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Active filters" value={String(changed)} />
        <Stat label="Preset" value={preset} />
      </div>

      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">CSS</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setFilter({ ...DEFAULTS }); setPreset('None'); }} className="text-[11px] text-muted-foreground transition hover:text-foreground">
              Reset
            </button>
            <CopyBtn value={`filter: ${css};`} />
          </div>
        </div>
        <pre className="overflow-auto whitespace-pre-wrap font-mono-j text-[11px] scrollbar-thin">{`filter: ${css};`}</pre>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Order matters: blur before opacity gives a glow, blur after contrast gives a haze. Filters are GPU-friendly and animate well, unlike box-shadow tricks.
        </p>
      </Panel>
    </ToolShell>
  );
}