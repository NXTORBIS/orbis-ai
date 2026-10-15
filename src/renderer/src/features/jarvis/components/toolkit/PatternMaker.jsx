import { useMemo, useState } from 'react';
import { Waves } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, CopyBtn, Panel, Stat, downloadBlob } from './shared';

const TYPES = ['stripes', 'diagonal', 'dots', 'grid', 'checker', 'waves', 'hexagons', 'crosses', 'triangles'];

const SCHEMES = [
  { id: 'Cyber', bg: '#050b16', ink: '#22d3ee' },
  { id: 'Midnight', bg: '#0f172a', ink: '#818cf8' },
  { id: 'Paper', bg: '#f8fafc', ink: '#0f172a' },
  { id: 'Candy', bg: '#fdf2f8', ink: '#ec4899' },
  { id: 'Forest', bg: '#f0fdf4', ink: '#16a34a' },
  { id: 'Mono', bg: '#ffffff', ink: '#111827' },
];

const tileFor = (type, size, thickness, ink) => {
  const line = Math.max(0.6, thickness / 2);
  if (type === 'stripes') return `<rect width="${thickness}" height="${size}" fill="${ink}"/>`;
  if (type === 'diagonal') return `<rect width="${thickness}" height="${size}" fill="${ink}"/>`;
  if (type === 'dots') return `<circle cx="${size / 2}" cy="${size / 2}" r="${thickness / 1.6}" fill="${ink}"/>`;
  if (type === 'grid') return `<path d="M0 0H${size}M0 0V${size}" stroke="${ink}" stroke-width="${line}" fill="none"/>`;
  if (type === 'checker') return `<rect width="${size / 2}" height="${size / 2}" fill="${ink}"/><rect x="${size / 2}" y="${size / 2}" width="${size / 2}" height="${size / 2}" fill="${ink}"/>`;
  if (type === 'waves') return `<path d="M0 ${size * 0.66} Q ${size * 0.25} ${size * 0.18} ${size * 0.5} ${size * 0.66} T ${size} ${size * 0.66}" stroke="${ink}" stroke-width="${line}" fill="none" stroke-linecap="round"/>`;
  if (type === 'hexagons') return `<polygon points="${size * 0.5},${size * 0.12} ${size * 0.88},${size * 0.32} ${size * 0.88},${size * 0.72} ${size * 0.5},${size * 0.92} ${size * 0.12},${size * 0.72} ${size * 0.12},${size * 0.32}" fill="none" stroke="${ink}" stroke-width="${line}"/>`;
  if (type === 'crosses') return `<path d="M${size / 2} ${size / 2 - thickness} V ${size / 2 + thickness} M${size / 2 - thickness} ${size / 2} H ${size / 2 + thickness}" stroke="${ink}" stroke-width="${line}" stroke-linecap="round"/>`;
  return `<polygon points="0,${size} ${size / 2},${size * 0.15} ${size},${size}" fill="${ink}"/>`;
};

const encode = (svg) => `data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22')}`;

export default function PatternMaker() {
  const [type, setType] = useState('waves');
  const [scheme, setScheme] = useState('Cyber');
  const [size, setSize] = useState(28);
  const [thickness, setThickness] = useState(6);
  const [rotation, setRotation] = useState(0);
  const [opacity, setOpacity] = useState(100);

  const palette = SCHEMES.find((s) => s.id === scheme) || SCHEMES[0];
  const rotationFor = type === 'diagonal' ? 45 + rotation : rotation;

  const svgs = useMemo(() => {
    const tile = tileFor(type, size, thickness, palette.ink);
    const tileSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${palette.bg}"/><g opacity="${opacity / 100}" transform="rotate(${rotationFor} ${size / 2} ${size / 2})">${tile}</g></svg>`;
    const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200" viewBox="0 0 640 200"><defs><pattern id="p" width="${size}" height="${size}" patternUnits="userSpaceOnUse" patternTransform="rotate(${rotationFor})"><rect width="${size}" height="${size}" fill="${palette.bg}"/><g opacity="${opacity / 100}">${tile}</g></pattern></defs><rect width="640" height="200" fill="url(#p)"/></svg>`;
    return { tileSvg, preview };
  }, [type, size, thickness, rotationFor, palette, opacity]);

  const css = `.pattern {\n  background-color: ${palette.bg};\n  background-image: url("${encode(svgs.tileSvg)}");\n  background-size: ${size}px ${size}px;\n}`;

  const download = () => {
    downloadBlob(new Blob([svgs.tileSvg], { type: 'image/svg+xml' }), `${type}-pattern.svg`);
  };

  return (
    <ToolShell
      toolId="pattern"
      icon={Waves}
      title="Pattern Generator"
      desc="Nine repeating background patterns as a pure SVG tile — preview, copy the CSS or take the file."
      state={{ type, scheme, size, thickness, rotation, opacity }}
      onRestore={(saved) => {
        if (saved.type) setType(saved.type);
        if (saved.scheme) setScheme(saved.scheme);
        setSize(saved.size ?? 28);
        setThickness(saved.thickness ?? 6);
        setRotation(saved.rotation ?? 0);
        setOpacity(saved.opacity ?? 100);
      }}
      exportText={css}
      exportName="pattern.css"
      exportMime="text/css"
    >
      <Field label="Pattern">
        <Seg value={type} onChange={setType} options={TYPES.map((t) => ({ value: t, label: t }))} />
      </Field>

      <Panel className="!p-2">
        <img src={encode(svgs.preview)} alt="Pattern preview" className="w-full rounded-lg" />
      </Panel>

      <div className="flex flex-wrap gap-1.5">
        {SCHEMES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setScheme(s.id)}
            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] transition ${scheme === s.id ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j tk-glow-ring' : 'border-border/70 text-muted-foreground hover:border-cyan-j/50'}`}
          >
            <span className="h-3 w-3 rounded-full border border-black/20" style={{ background: s.ink }} />
            {s.id}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Background · ${palette.bg.toUpperCase()}`}>
          <div className="h-9 w-full rounded-md border border-input" style={{ background: palette.bg }} />
        </Field>
        <Field label={`Ink · ${palette.ink.toUpperCase()}`}>
          <div className="h-9 w-full rounded-md border border-input" style={{ background: palette.ink }} />
        </Field>
      </div>

      <Field label={`Tile size · ${size}px`}>
        <input type="range" min={8} max={80} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Element size · ${thickness}`}>
        <input type="range" min={1} max={Math.max(2, Math.round(size / 2))} value={thickness} onChange={(e) => setThickness(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Rotation · ${type === 'diagonal' ? rotationFor : rotation}°`}>
        <input type="range" min={0} max={90} value={rotation} onChange={(e) => setRotation(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Opacity · ${opacity}%`}>
        <input type="range" min={10} max={100} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Tile" value={`${size} × ${size}`} mono />
        <Stat label="Rotation" value={`${rotationFor}°`} mono />
        <Stat label="Ink coverage" value={`${Math.round((thickness / size) * 100)}%`} />
      </div>

      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">CSS</span>
          <div className="flex gap-2">
            <button type="button" onClick={download} className="text-[11px] text-cyan-j transition hover:underline">
              Download tile
            </button>
            <CopyBtn value={css} />
          </div>
        </div>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono-j text-[10px] scrollbar-thin">{css}</pre>
      </Panel>

      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">SVG tile</span>
          <CopyBtn value={svgs.tileSvg} label="Copy SVG" />
        </div>
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono-j text-[10px] scrollbar-thin">{svgs.tileSvg}</pre>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          One small SVG tile repeats into any size of surface, and it stays crisp on every screen. Because it is just a background image,
          you can fade it, blend it or animate its position without touching the layout.
        </p>
      </Panel>
    </ToolShell>
  );
}