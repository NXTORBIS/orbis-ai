import { useMemo, useState } from 'react';
import { Shapes } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, CopyBtn, Panel, Stat, ToggleRow, downloadBlob } from './shared';

const STYLES = ['blocks', 'rings', 'shapes', 'bars'];

const PALETTES = [
  { id: 'Cyber', colours: ['#22d3ee', '#0ea5e9', '#6366f1'], bg: '#050b16' },
  { id: 'Sunset', colours: ['#fb7185', '#f97316', '#facc15'], bg: '#1b0d13' },
  { id: 'Forest', colours: ['#34d399', '#10b981', '#84cc16'], bg: '#052016' },
  { id: 'Candy', colours: ['#ec4899', '#a855f7', '#f472b6'], bg: '#fdf2f8' },
  { id: 'Ink', colours: ['#0f172a', '#334155', '#64748b'], bg: '#f8fafc' },
];

const encode = (svg) => `data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22')}`;

const makeRandom = (seed) => {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
};

const buildSvg = (style, seed, palette, size, radius) => {
  const rand = makeRandom(seed);
  const pick = () => palette.colours[Math.floor(rand() * palette.colours.length)];
  const inner = [];

  if (style === 'blocks') {
    const cells = 5;
    const step = size / cells;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < Math.ceil(cells / 2); x++) {
        if (rand() > 0.46) {
          const fill = pick();
          inner.push(`<rect x="${x * step}" y="${y * step}" width="${step}" height="${step}" fill="${fill}"/>`);
          inner.push(`<rect x="${(cells - 1 - x) * step}" y="${y * step}" width="${step}" height="${step}" fill="${fill}"/>`);
        }
      }
    }
  } else if (style === 'rings') {
    const rings = 3 + Math.floor(rand() * 3);
    for (let i = rings; i > 0; i--) {
      const r = (size / 2) * (i / rings);
      inner.push(`<circle cx="${size / 2}" cy="${size / 2}" r="${r.toFixed(1)}" fill="${rand() > 0.55 ? pick() : 'none'}" ${rand() > 0.55 ? '' : `stroke="${pick()}" stroke-width="${(size / 26).toFixed(2)}"`}/>`);
    }
  } else if (style === 'shapes') {
    for (let i = 0; i < 5; i++) {
      const cx = size * (0.25 + rand() * 0.5);
      const cy = size * (0.25 + rand() * 0.5);
      const r = size * (0.12 + rand() * 0.2);
      inner.push(rand() > 0.5
        ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${pick()}" opacity="0.85"/>`
        : `<polygon points="${cx.toFixed(1)},${(cy - r).toFixed(1)} ${(cx + r).toFixed(1)},${(cy + r).toFixed(1)} ${(cx - r).toFixed(1)},${(cy + r).toFixed(1)}" fill="${pick()}" opacity="0.85"/>`);
    }
  } else {
    const bars = 9;
    const step = size / bars;
    for (let i = 0; i < bars; i++) {
      const h = size * (0.2 + rand() * 0.8);
      inner.push(`<rect x="${(i * step).toFixed(1)}" y="${(size - h).toFixed(1)}" width="${(step * 0.62).toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(6, step / 4)}" fill="${pick()}"/>`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${palette.bg}"/><g>${inner.join('')}</g></svg>`;
};

export default function AvatarMaker() {
  const [seed, setSeed] = useState('mark32');
  const [salt, setSalt] = useState(0);
  const [style, setStyle] = useState('blocks');
  const [palette, setPalette] = useState('Cyber');
  const [size, setSize] = useState(320);
  const [radius, setRadius] = useState(64);
  const [transparent, setTransparent] = useState(false);

  const active = PALETTES.find((p) => p.id === palette) || PALETTES[0];
  const used = transparent ? { ...active, bg: 'none' } : active;

  const svg = useMemo(() => buildSvg(style, `${seed}-${salt}`, used, size, radius), [style, seed, salt, used, size, radius]);
  const uri = encode(svg);

  const downloadPng = () => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      canvas.getContext('2d').drawImage(img, 0, 0, 512, 512);
      canvas.toBlob((blob) => { if (blob) downloadBlob(blob, `${seed || 'avatar'}-${style}.png`); }, 'image/png');
    };
    img.src = uri;
  };

  return (
    <ToolShell
      toolId="avatar"
      icon={Shapes}
      title="Avatar Generator"
      desc="Deterministic identicons from any name — same seed, same mark, every time. SVG and PNG export."
      state={{ seed, style, palette, size, radius, transparent, salt }}
      onRestore={(saved) => {
        if (saved.seed !== undefined) setSeed(saved.seed);
        if (saved.style) setStyle(saved.style);
        if (saved.palette) setPalette(saved.palette);
        setSize(saved.size ?? 320);
        setRadius(saved.radius ?? 64);
        setTransparent(!!saved.transparent);
        setSalt(saved.salt ?? 0);
      }}
      exportText={svg}
      exportName={`${seed || 'avatar'}.svg`}
      exportMime="image/svg+xml"
    >
      <Panel className="!p-3">
        <div className="grid place-items-center">
          <img src={uri} alt="Avatar preview" className="h-44 w-44 rounded-2xl border border-border/70 sm:h-52 sm:w-52" />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setSalt((s) => s + 1)}
            className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
          >
            Another variation
          </button>
          <button type="button" onClick={downloadPng} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50">
            Download PNG
          </button>
          <CopyBtn value={svg} label="Copy SVG" />
        </div>
      </Panel>

      <Field label="Seed (a name, handle or email)">
        <input value={seed} onChange={(e) => setSeed(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
      </Field>

      <Field label="Style">
        <Seg value={style} onChange={setStyle} options={STYLES.map((s) => ({ value: s, label: s }))} />
      </Field>

      <Field label="Palette">
        <div className="flex flex-wrap gap-1.5">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPalette(p.id)}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] transition ${palette === p.id ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j tk-glow-ring' : 'border-border/70 text-muted-foreground hover:border-cyan-j/50'}`}
            >
              <span className="flex gap-0.5">
                {p.colours.map((c) => <span key={c} className="h-3 w-3 rounded-full border border-black/20" style={{ background: c }} />)}
              </span>
              {p.id}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Transparent background" checked={transparent} onChange={setTransparent} hint="for stacking" />
        <Field label={`Corner radius · ${radius}`}>
          <input type="range" min={0} max={160} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>

      <Field label={`Detail · ${size} units`}>
        <input type="range" min={160} max={640} step={20} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Style" value={style} />
        <Stat label="Palette" value={active.id} />
        <Stat label="Seed" value={seed || '—'} />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The same seed always draws the same avatar, so you can generate one on any device without storing an image.
          Perfect for user lists where you want a stable mark before anyone uploads a picture.
        </p>
      </Panel>
    </ToolShell>
  );
}