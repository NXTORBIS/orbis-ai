import { useEffect, useRef, useState } from 'react';
import { Waves } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const valueNoise = (width, height, gridSize, octaves, contrast) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);

  const layer = (size) => {
    const cols = Math.max(2, Math.floor(size));
    const rows = Math.max(2, Math.floor(size));
    const grid = Array.from({ length: rows + 1 }, () => Array.from({ length: cols + 1 }, () => Math.random()));
    return (u, v) => {
      const x = u * cols;
      const y = v * rows;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const tx = x - x0;
      const ty = y - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const top = grid[y0][x0] * (1 - sx) + grid[y0][x0 + 1] * sx;
      const bottom = grid[y0 + 1][x0] * (1 - sx) + grid[y0 + 1][x0 + 1] * sx;
      return top * (1 - sy) + bottom * sy;
    };
  };

  const noiseLayers = Array.from({ length: Math.max(1, Math.round(octaves)) }, (_, i) => layer(gridSize * 2 ** i));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      let amplitude = 1;
      let total = 0;
      noiseLayers.forEach((fn) => {
        value += fn(x / width, y / height) * amplitude;
        total += amplitude;
        amplitude *= 0.5;
      });
      const normalised = value / (total || 1);
      const shifted = Math.min(1, Math.max(0, (normalised - 0.5) * (1 + contrast / 40) + 0.5));
      const level = Math.round(shifted * 255);
      const index = (y * width + x) * 4;
      const r = level;
      const g = level;
      const b = level;
      image.data[index] = r;
      image.data[index + 1] = g;
      image.data[index + 2] = b;
      image.data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
};

const whiteNoise = (width, height, contrast) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  const spread = 1 + contrast / 30;
  for (let i = 0; i < image.data.length; i += 4) {
    const value = Math.min(255, Math.max(0, 128 + (Math.random() * 255 - 128) * spread));
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
};

const colourNoise = (width, height, scale) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const size = Math.max(2, Math.round(scale / 6));
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      ctx.fillStyle = `hsl(${Math.round(Math.random() * 360)} 55% ${35 + Math.round(Math.random() * 40)}%)`;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x, y, size, size);
    }
  }
  return canvas;
};

const BLENDS = [
  { value: 'overlay', label: 'Overlay' },
  { value: 'soft-light', label: 'Soft light' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'normal', label: 'Normal' },
];

export default function NoiseTexture() {
  const [type, setType] = useState('fractal');
  const [size, setSize] = useState(256);
  const [scale, setScale] = useState(5);
  const [octaves, setOctaves] = useState(4);
  const [contrast, setContrast] = useState(12);
  const [opacity, setOpacity] = useState(22);
  const [blend, setBlend] = useState('overlay');
  const [tile, setTile] = useState(220);
  const [url, setUrl] = useState('');
  const [seed, setSeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    setBusy(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const canvas = type === 'white' ? whiteNoise(size, size, contrast) : type === 'colour' ? colourNoise(size, size, scale * 6) : valueNoise(size, size, scale, octaves, contrast);
      setUrl(canvas.toDataURL('image/png'));
      setBusy(false);
    }, 180);
    return () => clearTimeout(timer.current);
  }, [type, size, scale, octaves, contrast, seed]);

  const savePng = () => {
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = `noise-${type}-${size}.png`;
    link.click();
  };

  const snippet = `.grain::after {\n  content: '';\n  position: absolute;\n  inset: 0;\n  pointer-events: none;\n  opacity: ${(opacity / 100).toFixed(2)};\n  mix-blend-mode: ${blend};\n  background-image: url('${url ? url.slice(0, 64) : 'data:image/png;base64,…'}');\n  background-size: ${tile}px ${tile}px;\n}`;

  return (
    <ToolShell
      toolId="noise"
      icon={Waves}
      title="Noise & Grain Generator"
      desc="Add film grain, paper tooth or subtle texture to a flat background — generate the tile, then keep it as a PNG or a CSS overlay."
      state={{ type, size, scale, octaves, contrast, opacity, blend, tile }}
      onRestore={(restored) => {
        if (restored.type) setType(restored.type);
        if (restored.size) setSize(Number(restored.size));
        if (restored.scale) setScale(Number(restored.scale));
        if (restored.octaves) setOctaves(Number(restored.octaves));
        if (restored.contrast !== undefined) setContrast(Number(restored.contrast));
        if (restored.opacity !== undefined) setOpacity(Number(restored.opacity));
        if (restored.blend) setBlend(restored.blend);
        if (restored.tile) setTile(Number(restored.tile));
      }}
      exportText={snippet}
      exportName="grain.css"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={type} onChange={setType} options={[{ value: 'fractal', label: 'Soft grain' }, { value: 'white', label: 'Film noise' }, { value: 'colour', label: 'Colour fleck' }]} />
        <button type="button" onClick={() => setSeed((s) => s + 1)} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          New grain
        </button>
        <button type="button" onClick={savePng} disabled={!url} className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 disabled:opacity-40">
          Save PNG tile
        </button>
        <CopyBtn value={snippet} label="Copy CSS" />
      </div>

      <div className="tk-card tk-depth relative overflow-hidden rounded-xl border border-border/70" style={{ background: 'linear-gradient(135deg,#0ea5e9,#8b5cf6 55%,#f97316)' }}>
        <div className="grid h-56 place-items-center">
          {url && (
            <div
              aria-hidden
              className="absolute inset-0"
              style={{ backgroundImage: `url(${url})`, backgroundSize: `${tile}px ${tile}px`, opacity: opacity / 100, mixBlendMode: blend }}
            />
          )}
          <div className="relative rounded-xl border border-white/25 bg-black/25 px-4 py-2 text-xs text-white/90 backdrop-blur">
            {busy ? 'generating…' : `${type} · ${size}px tile · ${opacity}% · ${blend}`}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Grain style">
          <Seg value={type} onChange={setType} options={[{ value: 'fractal', label: 'Soft' }, { value: 'white', label: 'Film' }, { value: 'colour', label: 'Fleck' }]} />
        </Field>
        <Field label="Tile size">
          <Seg value={size} onChange={setSize} options={[{ value: 128, label: '128' }, { value: 256, label: '256' }, { value: 512, label: '512' }]} />
        </Field>
        {type !== 'white' && (
          <Field label={`Scale · ${scale}`}>
            <input type="range" min={2} max={24} value={scale} onChange={(e) => setScale(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
          </Field>
        )}
        {type === 'fractal' && (
          <Field label={`Detail layers · ${octaves}`}>
            <input type="range" min={1} max={6} value={octaves} onChange={(e) => setOctaves(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
          </Field>
        )}
        <Field label={`Contrast · ${contrast}`}>
          <input type="range" min={-20} max={60} value={contrast} onChange={(e) => setContrast(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Opacity · ${opacity}%`}>
          <input type="range" min={2} max={100} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Repeat every · ${tile}px`}>
          <input type="range" min={80} max={600} step={10} value={tile} onChange={(e) => setTile(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label="Blend mode">
          <select value={blend} onChange={(e) => setBlend(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {BLENDS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Tile" value={`${size}×${size}`} mono />
        <Stat label="Repeat" value={`${tile}px`} mono />
        <Stat label="Blend" value={blend} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Grain is generated fresh each time you move a control, so every texture is unique. Soft grain at low opacity over a gradient is the classic
          trick for making flat design feel photographed — keep it under about 30% or it starts to look like a bad scan.
        </p>
      </Panel>
    </ToolShell>
  );
}