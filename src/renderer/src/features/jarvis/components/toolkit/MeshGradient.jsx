import { useMemo, useState } from 'react';
import { Blend, Shuffle } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const PRESETS = [
  { id: 'aurora', label: 'Aurora', stops: ['#22d3ee@20,18', '#a78bfa@78,14', '#f472b6@52,86', '#34d399@12,74'], base: '#050b18' },
  { id: 'sunset', label: 'Sunset', stops: ['#f97316@18,22', '#ef4444@74,20', '#8b5cf6@50,88', '#fbbf24@88,72'], base: '#160509' },
  { id: 'ocean', label: 'Ocean', stops: ['#0ea5e9@22,24', '#0f766e@76,30', '#22d3ee@46,84', '#1e3a8a@10,80'], base: '#03121f' },
  { id: 'candy', label: 'Candy', stops: ['#fb7185@16,20', '#c084fc@82,26', '#60a5fa@48,82', '#f9a8d4@90,80'], base: '#150716' },
  { id: 'graphite', label: 'Graphite', stops: ['#64748b@20,20', '#94a3b8@80,24', '#334155@50,84', '#0f172a@12,78'], base: '#0b1120' },
];

const parseStops = (stops) => stops.map((entry) => {
  const [color, pos] = entry.split('@');
  const [x, y] = (pos || '50,50').split(',').map(Number);
  return { color, x: x || 50, y: y || 50 };
});

const randomColor = () => `hsl(${Math.round(Math.random() * 360)} ${60 + Math.round(Math.random() * 30)}% ${45 + Math.round(Math.random() * 25)}%)`;

export default function MeshGradient() {
  const [stops, setStops] = useState(PRESETS[0].stops);
  const [base, setBase] = useState(PRESETS[0].base);
  const [softness, setSoftness] = useState(62);
  const [grain, setGrain] = useState(false);
  const [shape, setShape] = useState('full');

  const parsed = useMemo(() => parseStops(stops), [stops]);
  const layers = parsed.map((stop) => `radial-gradient(at ${stop.x}% ${stop.y}%, ${stop.color} 0px, transparent ${softness}%)`).join(', ');
  const css = `background-color: ${base};\nbackground-image: ${layers};`;

  const update = (index, patch) => setStops((current) => current.map((entry, i) => {
    if (i !== index) return entry;
    const current2 = parseStops([entry])[0];
    const next = { ...current2, ...patch };
    return `${next.color}@${Math.round(next.x)},${Math.round(next.y)}`;
  }));

  const randomise = () => {
    const count = 3 + Math.floor(Math.random() * 2);
    setStops(Array.from({ length: count }, () => `${randomColor()}@${Math.round(Math.random() * 92 + 4)},${Math.round(Math.random() * 88 + 6)}`));
    setBase(`hsl(${Math.round(Math.random() * 360)} 45% 6%)`);
  };

  const exportText = `.mesh {\n  ${css.replace(/\n/g, '\n  ')}\n}`;

  return (
    <ToolShell
      toolId="mesh-gradient"
      icon={Blend}
      title="Mesh Gradient Generator"
      desc="Layer soft colour fields into a modern mesh background, dial in the depth, then copy production-ready CSS."
      state={{ stops, base, softness, grain, shape }}
      onRestore={(restored) => {
        if (Array.isArray(restored.stops)) setStops(restored.stops);
        if (typeof restored.base === 'string') setBase(restored.base);
        if (restored.softness) setSoftness(Number(restored.softness));
        if (typeof restored.grain === 'boolean') setGrain(restored.grain);
        if (restored.shape) setShape(restored.shape);
      }}
      exportText={exportText}
      exportName="mesh-gradient.css"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={randomise} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          <Shuffle className="h-3.5 w-3.5" /> Surprise me
        </button>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => { setStops(p.stops); setBase(p.base); }}
            className="rounded-lg border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/40"
          >
            {p.label}
          </button>
        ))}
        <CopyBtn value={exportText} label="Copy CSS" />
      </div>

      <div
        className={`tk-card tk-depth relative overflow-hidden border border-border/70 ${shape === 'full' ? 'rounded-xl' : 'rounded-3xl'}`}
        style={{ backgroundColor: base, backgroundImage: layers, height: '19rem' }}
      >
        {grain && (
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.18] mix-blend-overlay"
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'120\' height=\'120\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'3\'/%3E%3C/filter%3E%3Crect width=\'120\' height=\'120\' filter=\'url(%23n)\' opacity=\'0.55\'/%3E%3C/svg%3E")' }}
          />
        )}
        <div className="absolute inset-x-4 bottom-4 flex items-center justify-between gap-3 rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-[11px] text-white/90 backdrop-blur">
          <span className="font-display tracking-wide">{parsed.length} colour fields</span>
          <span className="font-mono-j">softness {softness}%</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Base colour" hint="any CSS colour">
          <input value={base} onChange={(e) => setBase(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label={`Softness · ${softness}%`}>
          <input type="range" min={25} max={100} value={softness} onChange={(e) => setSoftness(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>

      <Field label="Colour fields">
        <div className="space-y-2">
          {parsed.map((stop, index) => (
            <div key={index} className="tk-card grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2 rounded-xl border border-border/70 bg-card/50 p-2">
              <input
                type="color"
                value={stop.color.startsWith('#') ? stop.color : '#22d3ee'}
                onChange={(e) => update(index, { color: e.target.value })}
                className="h-8 w-10 cursor-pointer rounded-md border border-input bg-transparent"
              />
              <label className="text-[10px] text-muted-foreground">
                X {Math.round(stop.x)}%
                <input type="range" min={0} max={100} value={stop.x} onChange={(e) => update(index, { x: Number(e.target.value) })} className="w-full accent-[hsl(var(--cyan))]" />
              </label>
              <label className="text-[10px] text-muted-foreground">
                Y {Math.round(stop.y)}%
                <input type="range" min={0} max={100} value={stop.y} onChange={(e) => update(index, { y: Number(e.target.value) })} className="w-full accent-[hsl(var(--cyan))]" />
              </label>
              <button
                type="button"
                onClick={() => setStops((current) => current.filter((_, i) => i !== index))}
                disabled={stops.length <= 2}
                className="rounded-md border border-border/60 px-2 py-1 text-[10px] text-muted-foreground transition hover:border-red-500/50 hover:text-red-500 disabled:opacity-30"
              >
                remove
              </button>
            </div>
          ))}
        </div>
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setStops((current) => [...current, `${randomColor()}@${Math.round(Math.random() * 90 + 5)},${Math.round(Math.random() * 90 + 5)}`].slice(0, 6))}
          disabled={stops.length >= 6}
          className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-[11px] text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40"
        >
          Add a field
        </button>
        <Seg value={grain ? 'grain' : 'clean'} onChange={(v) => setGrain(v === 'grain')} options={[{ value: 'clean', label: 'Clean' }, { value: 'grain', label: 'With grain' }]} />
        <Seg value={shape} onChange={setShape} options={[{ value: 'full', label: 'Edge to edge' }, { value: 'card', label: 'Rounded card' }]} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">CSS</div>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono-j text-[11px] text-cyan-j">{exportText}</pre>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Colour fields" value={String(parsed.length)} mono />
        <Stat label="Softness" value={`${softness}%`} mono />
        <Stat label="Texture" value={grain ? 'grain overlay' : 'smooth'} />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Each field is a radial gradient layered over a solid base, which renders sharply on every browser and costs nothing to animate — nudge the
          positions and you have a background that can drift slowly behind a hero.
        </p>
      </Panel>
    </ToolShell>
  );
}